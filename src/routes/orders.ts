import type { NextFunction, Request, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { BulkService } from "../services/bulk";
import type { OrderService } from "../services/orders";
import { parseBulkCreate, parseCancelBody, parseCreateOrder } from "../validation/order";
import type { OrderRecord, TrackingRow } from "../types";

function orderPayload(order: OrderRecord, extra: Record<string, unknown> = {}) {
  return {
    order_id: order.order_id,
    internal_id: order.id,
    courier_partner: order.courier_partner,
    courier_shipment_id: order.courier_shipment_id,
    awb_number: order.awb_number,
    status: order.status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    ...extra,
  };
}

function ok(res: Response, requestId: string, data: unknown, status = 200) {
  return res.status(status).json({ success: true, request_id: requestId, data });
}

export function createOrderRouter(orders: OrderService, bulk: BulkService): Router {
  const router = createRouter();

  router.post("/", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = parseCreateOrder(req.body);
      const result = await orders.create(input, req.requestId);
      return ok(
        res,
        req.requestId,
        orderPayload(result.order, { idempotent_replay: !result.created }),
        result.created ? 201 : 200,
      );
    } catch (err) {
      next(err);
    }
  });

  router.post("/bulk", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const inputs = parseBulkCreate(req.body);
      const job = await bulk.enqueue(inputs, req.requestId);
      return ok(
        res,
        req.requestId,
        {
          batch_id: job.batch_id,
          status: job.status,
          accepted: job.total,
          poll_url: `/api/v1/batches/${job.batch_id}`,
        },
        202,
      );
    } catch (err) {
      next(err);
    }
  });

  router.get("/:order_id/track", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await orders.track(req.params.order_id, req.requestId);
      const history = result.history.map((row: TrackingRow) => ({
        status: row.status,
        description: row.description,
        location: row.location,
        timestamp: row.recorded_at,
      }));
      const liveCurrent = result.live?.current;
      const current = liveCurrent
        ? {
            status: liveCurrent.status,
            description: liveCurrent.description,
            location: liveCurrent.location,
            timestamp: liveCurrent.timestamp,
          }
        : history[history.length - 1] ?? {
            status: result.order.status,
            description: result.order.status,
            timestamp: result.order.updated_at,
          };
      return ok(res, req.requestId, {
        order_id: result.order.order_id,
        courier_partner: result.order.courier_partner,
        awb_number: result.order.awb_number,
        status: result.order.status,
        current,
        history,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/:order_id/cancel", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = parseCancelBody(req.body);
      const result = await orders.cancel(req.params.order_id, body.reason, req.requestId);
      return ok(res, req.requestId, {
        ...orderPayload(result.order),
        cancelled_at: result.order.updated_at,
        idempotent_replay: result.replay,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createBatchRouter(bulk: BulkService): Router {
  const router = createRouter();
  router.get("/:batch_id", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const job = await bulk.get(req.params.batch_id);
      return ok(res, req.requestId, job);
    } catch (err) {
      next(err);
    }
  });
  return router;
}

export function createCourierRouter(orders: OrderService): Router {
  const router = createRouter();
  router.get("/", (_req: Request, res: Response) => {
    ok(res, _req.requestId, { partners: orders.supportedCouriers() });
  });
  return router;
}
