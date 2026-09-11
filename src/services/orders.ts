import { randomUUID } from "node:crypto";
import type { OrdersRepository } from "../db/mysqlRepo";
import { AppError, courierUnavailable, orderNotFound } from "../errors";
import { logger } from "../logger";
import type { CourierRegistry } from "../couriers/registry";
import type { CreateOrderInput, OrderRecord, ShipmentStatus } from "../types";

export class OrderService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly registry: CourierRegistry,
  ) {}

  supportedCouriers(): string[] {
    return this.registry.supported();
  }

  async create(input: CreateOrderInput, requestId: string) {
    this.registry.get(input.courier_partner);

    const insert = await this.repo.insertIfAbsent({
      id: randomUUID(),
      order_id: input.order_id,
      courier_partner: input.courier_partner,
      status: "CREATED",
      request_payload: input,
    });

    if (insert === "duplicate") {
      const existing = await this.repo.findByOrderId(input.order_id);
      if (!existing) throw orderNotFound(input.order_id);
      return { order: existing, created: false as const };
    }

    try {
      const adapter = this.registry.get(input.courier_partner);
      const result = await adapter.createShipment(input);
      await this.repo.updateAfterCourier({
        order_id: input.order_id,
        courier_shipment_id: result.courier_shipment_id,
        awb_number: result.awb_number,
        status: result.status,
        response_payload: { request: result.raw_request, response: result.raw_response },
        failure_reason: null,
      });
      await this.repo.appendTracking({
        order_id: input.order_id,
        status: result.status,
        description: "Shipment created",
        raw_payload: result.raw_response,
      });
      const order = await this.repo.findByOrderId(input.order_id);
      if (!order) throw orderNotFound(input.order_id);
      return { order, created: true as const };
    } catch (err) {
      await this.persistFailure(input, requestId, err);
      throw err;
    }
  }

  async track(orderId: string, requestId: string) {
    const order = await this.requireOrder(orderId);
    if (!order.awb_number) {
      return { order, history: await this.repo.listTracking(orderId) };
    }

    try {
      const adapter = this.registry.get(order.courier_partner);
      const tracking = await adapter.track({
        order_id: order.order_id,
        awb_number: order.awb_number,
        courier_shipment_id: order.courier_shipment_id,
      });

      if (tracking.status !== order.status) {
        await this.repo.updateAfterCourier({
          order_id: order.order_id,
          courier_shipment_id: order.courier_shipment_id,
          awb_number: order.awb_number,
          status: tracking.status,
          response_payload: tracking.raw_response,
          failure_reason: null,
        });
        await this.repo.appendTracking({
          order_id: order.order_id,
          status: tracking.status,
          description: tracking.current.description,
          location: tracking.current.location,
          raw_payload: tracking.raw_response,
        });
      }

      const updated = await this.requireOrder(orderId);
      const history = await this.repo.listTracking(orderId);
      return { order: updated, history, live: tracking };
    } catch (err) {
      this.logFailure(order.order_id, order.courier_partner, requestId, err);
      throw err;
    }
  }

  async cancel(orderId: string, reason: string | undefined, requestId: string) {
    const order = await this.requireOrder(orderId);
    if (order.status === "CANCELLED") {
      return { order, replay: true as const };
    }
    if (order.status === "DELIVERED") {
      throw new AppError(
        "CANCELLATION_NOT_ALLOWED",
        "Delivered shipments cannot be cancelled",
        409,
      );
    }
    if (!order.awb_number) {
      throw new AppError("CANCELLATION_NOT_ALLOWED", "Shipment has no AWB to cancel", 409);
    }

    try {
      const adapter = this.registry.get(order.courier_partner);
      const result = await adapter.cancel({
        order_id: order.order_id,
        awb_number: order.awb_number,
        reason,
      });
      await this.repo.updateAfterCourier({
        order_id: order.order_id,
        courier_shipment_id: order.courier_shipment_id,
        awb_number: order.awb_number,
        status: "CANCELLED",
        response_payload: { request: result.raw_request, response: result.raw_response },
        failure_reason: null,
      });
      await this.repo.appendTracking({
        order_id: order.order_id,
        status: "CANCELLED",
        description: reason ?? "Cancelled",
        raw_payload: result.raw_response,
      });
      return { order: await this.requireOrder(orderId), replay: false as const };
    } catch (err) {
      this.logFailure(order.order_id, order.courier_partner, requestId, err);
      throw err;
    }
  }

  private async requireOrder(orderId: string): Promise<OrderRecord> {
    const order = await this.repo.findByOrderId(orderId);
    if (!order) throw orderNotFound(orderId);
    return order;
  }

  private async persistFailure(input: CreateOrderInput, requestId: string, err: unknown) {
    const mapped = err instanceof AppError ? err : courierUnavailable("Unexpected courier failure");
    const status: ShipmentStatus = "FAILED";
    await this.repo.updateAfterCourier({
      order_id: input.order_id,
      courier_shipment_id: null,
      awb_number: null,
      status,
      response_payload: { error: mapped.message, code: mapped.code },
      failure_reason: mapped.message.slice(0, 500),
    });
    await this.repo.appendTracking({
      order_id: input.order_id,
      status,
      description: mapped.message,
      raw_payload: { code: mapped.code, message: mapped.message },
    });
    this.logFailure(input.order_id, input.courier_partner, requestId, err);
  }

  private logFailure(orderId: string, partner: string, requestId: string, err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error({
      msg: "order_failure",
      order_id: orderId,
      courier_partner: partner,
      request_id: requestId,
      error_type: err instanceof AppError ? err.code : error.name,
      err: error.message,
      stack: error.stack,
    });
  }
}
