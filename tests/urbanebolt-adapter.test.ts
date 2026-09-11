import { describe, expect, it, vi } from "vitest";
import { UrbaneBoltAdapter } from "../src/couriers/urbanebolt/adapter";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("UrbaneBolt adapter", () => {
  it("authenticates, creates a shipment, and maps AWB", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("/auth/getToken/")) {
        return jsonResponse(200, { token: "t-1" });
      }
      if (href.includes("/services/manifest/")) {
        return jsonResponse(200, { data: [{ orderNumber: "ORD-UB-1", awb: "200000001170" }] });
      }
      return jsonResponse(404, { message: "missing" });
    });

    const adapter = new UrbaneBoltAdapter(fetchImpl as unknown as typeof fetch, {
      baseUrl: "https://uat.urbanebolt.in",
      username: "user",
      password: "pass",
      customerCode: "UEBCUS0008",
      csrfToken: "test-csrf",
      timeoutMs: 500,
      retryCount: 0,
      retryBackoffMs: 1,
    });

    const result = await adapter.createShipment({
      order_id: "ORD-UB-1",
      courier_partner: "urbanebolt",
      payment_mode: "PREPAID",
      pickup: {
        name: "A",
        phone: "9876543210",
        address_line1: "x",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001",
        country: "IN",
      },
      delivery: {
        name: "B",
        phone: "9123456780",
        address_line1: "y",
        city: "Kolkata",
        state: "WB",
        pincode: "700016",
        country: "IN",
      },
      package: {
        weight_grams: 500,
        length_cm: 10,
        width_cm: 8,
        height_cm: 4,
        items: [{ sku: "s", name: "n", qty: 1, price: 10 }],
      },
    });

    expect(result.awb_number).toBe("200000001170");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(tokenUrl)).toContain("/api/v1/auth/getToken/");
    expect(JSON.parse(String(tokenInit.body))).toEqual({ username: "user", password: "pass" });
    const headers = tokenInit.headers as Record<string, string>;
    expect(headers.Cookie).toBe("csrftoken=test-csrf");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("re-authenticates once on 401", async () => {
    let tokenCalls = 0;
    let manifestCalls = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/auth/getToken/")) {
        tokenCalls += 1;
        return jsonResponse(200, { token: `t-${tokenCalls}` });
      }
      if (href.includes("/services/tracking-pub/")) {
        const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
        if (auth.includes("t-1") && manifestCalls === 0) {
          manifestCalls += 1;
          return jsonResponse(401, { message: "expired" });
        }
        return jsonResponse(200, { status: "In Transit", history: [] });
      }
      return jsonResponse(404, {});
    });

    const adapter = new UrbaneBoltAdapter(fetchImpl as unknown as typeof fetch, {
      baseUrl: "https://uat.urbanebolt.in",
      username: "user",
      password: "pass",
      customerCode: "UEBCUS0008",
      csrfToken: "test-csrf",
      timeoutMs: 500,
      retryCount: 0,
      retryBackoffMs: 1,
    });

    const tracked = await adapter.track({ order_id: "ORD-1", awb_number: "200000001170" });
    expect(tracked.status).toBe("IN_TRANSIT");
    expect(tokenCalls).toBe(2);
  });
});
