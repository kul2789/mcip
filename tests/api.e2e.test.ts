import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { MockCourierAdapter } from "../src/couriers/mock";
import { CourierRegistry } from "../src/couriers/registry";
import { MemoryOrdersRepository } from "../src/db/memoryRepo";
import { sampleOrder, waitFor } from "./helpers";

function buildApp() {
  const repo = new MemoryOrdersRepository();
  const registry = new CourierRegistry([new MockCourierAdapter()]);
  return { app: createApp({ repo, registry }), repo };
}

describe("unified API", () => {
  it("creates, tracks, and cancels via mock courier", async () => {
    const { app } = buildApp();
    const created = await request(app).post("/api/v1/orders").send(sampleOrder({ order_id: "ORD-E2E-1" }));
    expect(created.status).toBe(201);
    expect(created.body.data.awb_number).toBe("MOCK-ORD-E2E-1");
    expect(created.body.data.courier_partner).toBe("mock");

    const replay = await request(app).post("/api/v1/orders").send(sampleOrder({ order_id: "ORD-E2E-1" }));
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotent_replay).toBe(true);

    const tracked = await request(app).get("/api/v1/orders/ORD-E2E-1/track");
    expect(tracked.status).toBe(200);
    expect(tracked.body.data.history.length).toBeGreaterThanOrEqual(1);

    const cancelled = await request(app)
      .post("/api/v1/orders/ORD-E2E-1/cancel")
      .send({ reason: "Customer request" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("CANCELLED");
  });

  it("returns 400 for unknown courier with supported list", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/orders")
      .send(sampleOrder({ courier_partner: "delhivery" }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNSUPPORTED_COURIER");
    expect(res.body.error.details.supported).toEqual(["mock"]);
  });

  it("maps courier business rejection without leaking internals", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/orders")
      .send(
        sampleOrder({
          order_id: "ORD-FAIL-1",
          delivery: {
            ...sampleOrder().delivery,
            pincode: "000000",
          },
        }),
      );
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("COURIER_REJECTED");
    expect(JSON.stringify(res.body)).not.toMatch(/urbanebolt/i);
  });

  it("processes bulk asynchronously with partial success", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/v1/orders/bulk")
      .send({
        orders: [
          sampleOrder({ order_id: "ORD-B-1" }),
          sampleOrder({
            order_id: "ORD-B-2",
            delivery: { ...sampleOrder().delivery, pincode: "000000" },
          }),
        ],
      });
    expect(res.status).toBe(202);
    const batchId = res.body.data.batch_id as string;

    await waitFor(async () => {
      const poll = await request(app).get(`/api/v1/batches/${batchId}`);
      return poll.body.data.status === "PARTIAL";
    });

    const poll = await request(app).get(`/api/v1/batches/${batchId}`);
    expect(poll.body.data.succeeded).toBe(1);
    expect(poll.body.data.failed).toBe(1);
    expect(poll.body.data.results[0].success).toBe(true);
    expect(poll.body.data.results[1].error.code).toBe("COURIER_REJECTED");
  });

  it("lists supported couriers", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/v1/couriers");
    expect(res.status).toBe(200);
    expect(res.body.data.partners).toEqual(["mock"]);
  });
});
