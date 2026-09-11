import { describe, expect, it } from "vitest";
import { MockCourierAdapter } from "../src/couriers/mock";
import { CourierRegistry } from "../src/couriers/registry";
import { AppError } from "../src/errors";

describe("courier registry", () => {
  it("resolves registered partners and lists them", () => {
    const registry = new CourierRegistry([new MockCourierAdapter()]);
    expect(registry.get("MOCK").partner).toBe("mock");
    expect(registry.supported()).toEqual(["mock"]);
  });

  it("rejects unknown partners with supported list", () => {
    const registry = new CourierRegistry([new MockCourierAdapter()]);
    try {
      registry.get("delhivery");
      throw new Error("expected unsupported courier");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppError;
      expect(appErr.code).toBe("UNSUPPORTED_COURIER");
      expect(appErr.httpStatus).toBe(400);
      expect(appErr.details).toEqual({ supported: ["mock"] });
    }
  });
});
