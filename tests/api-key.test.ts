import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { MockCourierAdapter } from "../src/couriers/mock";
import { CourierRegistry } from "../src/couriers/registry";
import { MemoryOrdersRepository } from "../src/db/memoryRepo";
import { sampleOrder } from "./helpers";

function buildApp(apiKey?: string) {
  const repo = new MemoryOrdersRepository();
  const registry = new CourierRegistry([new MockCourierAdapter()]);
  return createApp({ repo, registry, apiKey });
}

describe("X-Api-Key", () => {
  it("does not require a key when MCIP_API_KEY is unset", async () => {
    const app = buildApp("");
    const res = await request(app).get("/api/v1/couriers");
    expect(res.status).toBe(200);
    expect(res.body.data.partners).toEqual(["mock"]);
  });

  it("returns 401 on /api/v1 without a key when configured", async () => {
    const app = buildApp("secret-test-key");
    const res = await request(app).get("/api/v1/couriers");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(res.body.request_id).toBeTruthy();
  });

  it("returns 401 when the key does not match", async () => {
    const app = buildApp("secret-test-key");
    const res = await request(app).get("/api/v1/couriers").set("X-Api-Key", "wrong");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("allows /api/v1 when the header matches", async () => {
    const app = buildApp("secret-test-key");
    const created = await request(app)
      .post("/api/v1/orders")
      .set("X-Api-Key", "secret-test-key")
      .send(sampleOrder({ order_id: "ORD-KEY-1" }));
    expect(created.status).toBe(201);
    expect(created.body.data.order_id).toBe("ORD-KEY-1");
  });

  it("leaves /health and /api/docs.json open when a key is configured", async () => {
    const app = buildApp("secret-test-key");
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);
    const spec = await request(app).get("/api/docs.json");
    expect(spec.status).toBe(200);
    expect(spec.body.info.title).toMatch(/MCIP/);
  });
});
