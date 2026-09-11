import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { parseBulkCreate, parseCreateOrder } from "../src/validation/order";
import { sampleOrder } from "./helpers";

describe("order validation", () => {
  it("accepts a valid payload", () => {
    const parsed = parseCreateOrder(sampleOrder());
    expect(parsed.courier_partner).toBe("mock");
    expect(parsed.delivery.pincode).toBe("700016");
  });

  it("returns field-level errors", () => {
    try {
      parseCreateOrder({ order_id: "", courier_partner: "mock" });
      throw new Error("expected validation error");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.httpStatus).toBe(400);
      expect(appErr.code).toBe("VALIDATION_ERROR");
      expect(Array.isArray(appErr.details)).toBe(true);
    }
  });

  it("requires cod_amount for COD", () => {
    try {
      parseCreateOrder(sampleOrder({ payment_mode: "COD", cod_amount: 0 }));
      throw new Error("expected validation error");
    } catch (err) {
      expect((err as AppError).code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects more than 100 bulk orders", () => {
    const orders = Array.from({ length: 101 }, (_, i) => sampleOrder({ order_id: `ORD-${i}` }));
    try {
      parseBulkCreate({ orders });
      throw new Error("expected validation error");
    } catch (err) {
      expect((err as AppError).code).toBe("VALIDATION_ERROR");
    }
  });
});
