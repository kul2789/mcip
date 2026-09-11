import { describe, expect, it } from "vitest";
import { extractAwb, extractToken, toManifestPayload } from "../src/couriers/urbanebolt/map";
import { mapCourierStatus } from "../src/couriers/status";
import { sampleOrder } from "./helpers";

describe("urbanebolt mapper", () => {
  it("maps normalized order to UrbaneBolt manifest fields", () => {
    const [row] = toManifestPayload(
      sampleOrder({
        order_id: "ORD-UB-1",
        payment_mode: "COD",
        cod_amount: 199,
        service_type: "SDD",
      }),
      "UEBCUS0008",
    );
    expect(row.customerCode).toBe("UEBCUS0008");
    expect(row.orderNumber).toBe("ORD-UB-1");
    expect(row.payMode).toBe("COD");
    expect(row.collectableValue).toBe(199);
    expect(row.consPincode).toBe(700016);
    expect(row.shprMobile).toBe(9876543210);
    expect(row.weight).toBe(0.5);
    expect(row.itemDescription).toBe("T-shirt");
  });

  it("extracts tokens from several response shapes", () => {
    expect(extractToken({ token: "abc" })).toBe("abc");
    expect(extractToken({ data: { access_token: "xyz" } })).toBe("xyz");
    expect(
      extractToken({
        access_token: "jK0A6hycBSo87SscldjNU1o4cNBl3a",
        token_type: "Bearer",
        status: "Success",
      }),
    ).toBe("jK0A6hycBSo87SscldjNU1o4cNBl3a");
  });

  it("extracts AWB from nested courier payloads", () => {
    expect(extractAwb({ data: [{ orderNumber: "ORD-1", awb: "UB1" }] }, "ORD-1")).toEqual({
      awb: "UB1",
      shipmentId: "UB1",
    });
    expect(
      extractAwb(
        {
          status: "Success",
          successResponse: [
            { status: "Success", orderNumber: "ORD-1", awbNumber: 200000007859, customerCode: "UEBCUS0008" },
          ],
          errorResponse: [],
        },
        "ORD-1",
      ),
    ).toEqual({ awb: "200000007859", shipmentId: "200000007859" });
  });

  it("normalizes courier statuses", () => {
    expect(mapCourierStatus("Picked Up")).toBe("PICKED_UP");
    expect(mapCourierStatus("In Transit - Hub")).toBe("IN_TRANSIT");
    expect(mapCourierStatus("Delivered")).toBe("DELIVERED");
    expect(mapCourierStatus("Cancelled by customer")).toBe("CANCELLED");
    expect(mapCourierStatus("Shipment Manifested")).toBe("CREATED");
  });
});
