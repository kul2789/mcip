import { randomUUID } from "node:crypto";
import type {
  BatchStatus,
  BulkJob,
  BulkOrderResult,
  OrderRecord,
  ShipmentStatus,
  TrackingRow,
} from "../types";
import type { InsertOrderInput, OrdersRepository } from "./mysqlRepo";

function now(): string {
  return new Date().toISOString();
}

export class MemoryOrdersRepository implements OrdersRepository {
  private orders = new Map<string, OrderRecord>();
  private tracking: TrackingRow[] = [];
  private batches = new Map<string, BulkJob>();

  async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    return this.orders.get(orderId) ?? null;
  }

  async insertIfAbsent(input: InsertOrderInput): Promise<"inserted" | "duplicate"> {
    if (this.orders.has(input.order_id)) return "duplicate";
    const ts = now();
    this.orders.set(input.order_id, {
      id: input.id,
      order_id: input.order_id,
      courier_partner: input.courier_partner,
      courier_shipment_id: null,
      awb_number: null,
      status: input.status,
      request_payload: input.request_payload,
      response_payload: null,
      failure_reason: null,
      created_at: ts,
      updated_at: ts,
    });
    return "inserted";
  }

  async updateAfterCourier(input: {
    order_id: string;
    courier_shipment_id: string | null;
    awb_number: string | null;
    status: ShipmentStatus;
    response_payload: unknown;
    failure_reason?: string | null;
  }): Promise<void> {
    const existing = this.orders.get(input.order_id);
    if (!existing) return;
    this.orders.set(input.order_id, {
      ...existing,
      courier_shipment_id: input.courier_shipment_id,
      awb_number: input.awb_number,
      status: input.status,
      response_payload: input.response_payload,
      failure_reason: input.failure_reason ?? null,
      updated_at: now(),
    });
  }

  async appendTracking(input: {
    order_id: string;
    status: ShipmentStatus;
    description?: string | null;
    location?: string | null;
    raw_payload: unknown;
  }): Promise<void> {
    this.tracking.push({
      id: randomUUID(),
      order_id: input.order_id,
      status: input.status,
      description: input.description ?? null,
      location: input.location ?? null,
      raw_payload: input.raw_payload,
      recorded_at: now(),
    });
  }

  async listTracking(orderId: string): Promise<TrackingRow[]> {
    return this.tracking.filter((row) => row.order_id === orderId);
  }

  async createBatch(input: {
    batch_id: string;
    total: number;
    results: BulkOrderResult[];
  }): Promise<void> {
    const ts = now();
    this.batches.set(input.batch_id, {
      batch_id: input.batch_id,
      status: "QUEUED",
      total: input.total,
      succeeded: 0,
      failed: 0,
      results: input.results,
      created_at: ts,
      updated_at: ts,
    });
  }

  async getBatch(batchId: string): Promise<BulkJob | null> {
    return this.batches.get(batchId) ?? null;
  }

  async saveBatch(job: BulkJob): Promise<void> {
    this.batches.set(job.batch_id, { ...job, updated_at: now(), status: job.status as BatchStatus });
  }
}
