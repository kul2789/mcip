import { courierRejected } from "../errors";
import type {
  CancelRef,
  CreateOrderInput,
  NormalizedCancel,
  NormalizedShipment,
  NormalizedTracking,
  TrackingRef,
} from "../types";
import type { CourierPort } from "./port";

/**
 * In-process courier used to prove the registry is plug-in based.
 * No network calls. Deterministic AWB: MOCK-<order_id>.
 * Pincode 000000 simulates a courier business rejection.
 */
export class MockCourierAdapter implements CourierPort {
  readonly partner = "mock";
  private readonly store = new Map<
    string,
    { status: NormalizedShipment["status"]; cancelled: boolean; orderId: string }
  >();

  async createShipment(input: CreateOrderInput): Promise<NormalizedShipment> {
    if (input.delivery.pincode === "000000") {
      throw courierRejected("Delivery pincode not serviceable");
    }
    const awb = `MOCK-${input.order_id}`;
    const payload = {
      mock: true,
      order_id: input.order_id,
      delivery_pincode: input.delivery.pincode,
    };
    this.store.set(awb, { status: "CREATED", cancelled: false, orderId: input.order_id });
    return {
      courier_shipment_id: `MSHIP-${input.order_id}`,
      awb_number: awb,
      status: "CREATED",
      raw_request: payload,
      raw_response: { awb, status: "CREATED" },
    };
  }

  async track(ref: TrackingRef): Promise<NormalizedTracking> {
    const row = this.store.get(ref.awb_number);
    const status = row?.cancelled ? "CANCELLED" : row?.status ?? "IN_TRANSIT";
    const current = {
      status,
      description: `Mock status ${status}`,
      location: "Mock Hub",
      timestamp: new Date().toISOString(),
      raw: { awb: ref.awb_number, status },
    };
    if (row && status === "CREATED") {
      row.status = "IN_TRANSIT";
    }
    return {
      awb_number: ref.awb_number,
      status: current.status,
      current,
      history: [current],
      raw_response: { awb: ref.awb_number, status: current.status },
    };
  }

  async cancel(ref: CancelRef): Promise<NormalizedCancel> {
    const row = this.store.get(ref.awb_number);
    if (row) {
      row.cancelled = true;
      row.status = "CANCELLED";
    }
    return {
      awb_number: ref.awb_number,
      status: "CANCELLED",
      raw_request: { awb: ref.awb_number, reason: ref.reason },
      raw_response: { awb: ref.awb_number, cancelled: true },
    };
  }
}
