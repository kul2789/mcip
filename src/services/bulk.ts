import { randomUUID } from "node:crypto";
import type { OrdersRepository } from "../db/mysqlRepo";
import { AppError, batchNotFound } from "../errors";
import { logger } from "../logger";
import type { BulkJob, BulkOrderResult, CreateOrderInput } from "../types";
import type { OrderService } from "./orders";

export class ConcurrencyPool {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.running += 1;
        fn()
          .then(resolve, reject)
          .finally(() => {
            this.running -= 1;
            const next = this.queue.shift();
            if (next) next();
          });
      };
      if (this.running < this.limit) start();
      else this.queue.push(start);
    });
  }
}

export class BulkService {
  private readonly pool: ConcurrencyPool;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: OrdersRepository,
    private readonly orders: OrderService,
    concurrency: number,
  ) {
    this.pool = new ConcurrencyPool(concurrency);
  }

  async enqueue(inputs: CreateOrderInput[], requestId: string): Promise<BulkJob> {
    const batchId = randomUUID();
    const placeholders: BulkOrderResult[] = inputs.map((input) => ({
      order_id: input.order_id,
      success: false,
      courier_partner: input.courier_partner,
    }));
    await this.repo.createBatch({ batch_id: batchId, total: inputs.length, results: placeholders });

    setImmediate(() => {
      this.process(batchId, inputs, requestId).catch((err) => {
        logger.error({
          msg: "bulk_process_failed",
          request_id: requestId,
          error_type: "bulk",
          err: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      });
    });

    const job = await this.repo.getBatch(batchId);
    if (!job) throw batchNotFound(batchId);
    return job;
  }

  async get(batchId: string): Promise<BulkJob> {
    const job = await this.repo.getBatch(batchId);
    if (!job) throw batchNotFound(batchId);
    return job;
  }

  private async process(batchId: string, inputs: CreateOrderInput[], requestId: string) {
    await this.patch(batchId, (job) => {
      job.status = "PROCESSING";
    });

    await Promise.all(
      inputs.map((input, index) =>
        this.pool.run(async () => {
          try {
            const result = await this.orders.create(input, requestId);
            await this.patch(batchId, (job) => {
              job.results[index] = {
                order_id: input.order_id,
                success: true,
                courier_partner: input.courier_partner,
                awb_number: result.order.awb_number ?? undefined,
                status: result.order.status,
                idempotent_replay: !result.created,
              };
              job.succeeded += 1;
            });
          } catch (err) {
            const error =
              err instanceof AppError
                ? { code: err.code, message: err.message }
                : { code: "INTERNAL_ERROR", message: "Order failed" };
            logger.error({
              msg: "bulk_order_failed",
              order_id: input.order_id,
              courier_partner: input.courier_partner,
              request_id: requestId,
              error_type: error.code,
              err: error.message,
              stack: err instanceof Error ? err.stack : undefined,
            });
            await this.patch(batchId, (job) => {
              job.results[index] = {
                order_id: input.order_id,
                success: false,
                courier_partner: input.courier_partner,
                error,
              };
              job.failed += 1;
            });
          }
        }),
      ),
    );

    await this.patch(batchId, (job) => {
      job.status = job.failed === 0 ? "COMPLETED" : "PARTIAL";
    });
  }

  private async patch(batchId: string, mutate: (job: BulkJob) => void): Promise<void> {
    const previous = this.locks.get(batchId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(batchId, previous.then(() => current));
    await previous;
    try {
      const job = await this.repo.getBatch(batchId);
      if (!job) return;
      mutate(job);
      await this.repo.saveBatch(job);
    } finally {
      release();
      if (this.locks.get(batchId) === current) this.locks.delete(batchId);
    }
  }
}
