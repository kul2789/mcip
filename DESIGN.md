# DESIGN.md

## Problem

Internal systems (OMS, frontend) must talk to many courier partners through **one API**. UrbaneBolt is the first live integration; Delhivery / Shiprocket / Bluedart must be addable later **without editing controllers, DTOs, or existing adapters**.

## Pattern: Strategy + Adapter + Registry

```
HTTP  →  X-Api-Key (if MCIP_API_KEY set)  →  controllers  →  OrderService  →  CourierRegistry.get(partner)
                                                                                              ├─ UrbaneBoltAdapter
                                                                                              └─ MockCourierAdapter
```

- **`CourierPort`** is the strategy contract: `createShipment`, `track`, `cancel`.
- Each partner is an **adapter** that maps our normalized schema to that courier’s HTTP API.
- **`CourierRegistry`** is a map of `courier_partner` → adapter. Unknown partners return HTTP 400 plus the supported list.
- Controllers never import UrbaneBolt. Adding a courier is one new class + one registry line (Open/Closed).

MockCourier is a second adapter with the same port. It exists to prove the design, not as a stub for missing code.

## Why Express (and not Nest)

The assignment needs a visible boundary, not a DI container. Express + a 20-line registry makes the plug-in rule obvious in review. Dependencies stay small: `express`, `zod`, `mysql2`, `pino`, `swagger-ui-express`.

## Request flow (create)

0. If `MCIP_API_KEY` is set, require header `X-Api-Key` (timing-safe compare). Miss/mismatch → `401 UNAUTHORIZED`. Empty env skips this step. `/health` and `/api/docs` are never gated. This authenticates **MCIP consumers** (OMS); UrbaneBolt still uses its own token inside the adapter.
1. Zod validates the **normalized** body (`order_id`, `courier_partner`, pickup/delivery/package). Field errors → HTTP 400.
2. Registry resolves the adapter (or 400 `UNSUPPORTED_COURIER`).
3. Insert `orders` row. Unique `order_id` → if duplicate, return the existing shipment (`200` + `idempotent_replay`).
4. Adapter calls the courier. Full request/response JSON is stored on the row (audit).
5. First tracking event is appended (`tracking_events` is insert-only).
6. Courier 4xx → `COURIER_REJECTED` (mapped message, never raw). 5xx/timeout → retry, then `FAILED` + `COURIER_UNAVAILABLE`.

Auth (UrbaneBolt): `POST /api/v1/auth/getToken/` with env credentials. Token cached in the adapter. `401` → re-auth once + retry.

## Database

MySQL 8 / InnoDB.

**`orders`** — one row per client `order_id` (unique): internal UUID, partner, courier shipment id, AWB, status, request JSON, response JSON, timestamps.

**`tracking_events`** — append-only history (status, description, location, raw payload, timestamp). Never updated.

**`bulk_jobs`** — `batch_id`, counters, JSON results array.

## Bulk of 100

`POST /api/v1/orders/bulk` validates (max 100), persists a `QUEUED` job, and returns **`202` + `batch_id` immediately**. An in-process pool (default concurrency 10) creates orders concurrently. Mixed `courier_partner` is allowed. Partial success is first-class: poll `GET /api/v1/batches/{id}` for per-order success/failure.

**Trade-off:** no extra infrastructure; jobs die on process restart. That is acceptable for this assignment. The HTTP contract (`batch_id` + poll) is the same one you would keep in front of Redis/BullMQ later.

Sequential courier calls inside the POST are rejected by the spec. `Promise.all` of 100 inside the request would still block the client and amplify timeouts.

## Errors

Single envelope for every endpoint:

```json
{ "success": false, "request_id": "...", "error": { "code": "...", "message": "...", "details": [] } }
```

| Code | HTTP |
|---|---|
| `UNAUTHORIZED` | 401 |
| `VALIDATION_ERROR` | 400 |
| `UNSUPPORTED_COURIER` | 400 |
| `ORDER_NOT_FOUND` | 404 |
| `CANCELLATION_NOT_ALLOWED` | 409 |
| `COURIER_REJECTED` | 422 |
| `COURIER_UNAVAILABLE` | 502 |

Logs always include `order_id`, `courier_partner`, `request_id`, `error_type`, and stack where useful.

## Tests

`npm test` runs **24 Vitest cases** (in-memory repo + MockCourier + mocked `fetch`). They do not need MySQL, `.env`, or UAT.

Covered: unified create/track/cancel, idempotent `order_id`, unsupported courier, courier rejection mapped to `422`, bulk `202` with partial success, registry, UrbaneBolt payload/AWB mapping, HTTP retry on timeout/5xx, optional `X-Api-Key` (off when unset; 401 missing/wrong; success with matching header; health/docs stay open).

Live UAT is a manual/demo path (`https://mcip.kavyaretail.in/api/docs` with `courier_partner: "urbanebolt"`).

**GitHub Actions was not included.** The brief’s deliverables were GitHub + README + design, not a pipeline. Tests need no MySQL, secrets, or UAT, so `npm test` on a clone is the review path. A workflow that only runs `npm ci && npm test` would not have changed the design; it was skipped to keep the 2-day scope on the integration platform. It is the first mechanical add-on after submission.

## Config

Courier credentials, `MCIP_API_KEY`, base URLs, timeouts, retry counts, bulk concurrency, and UrbaneBolt `customerCode` come from environment variables only. `.env` is gitignored.

## Production notes

This assignment run is a single Node process (PM2) + MySQL + nginx TLS. That is enough to demonstrate the contract; it is not a production SLA.

- **Bulk is in-process.** `202` + `batch_id` persist in MySQL, but the worker is `setImmediate` in this process. A restart drops in-flight jobs. The HTTP contract stays the same if Redis/BullMQ (or a MySQL `FOR UPDATE SKIP LOCKED` worker) is swapped in later.
- **Consumer auth is optional `X-Api-Key`.** Set `MCIP_API_KEY` to require the header on `/api/v1/*`. Empty (local tests, current demo) leaves the API open. This is not UrbaneBolt auth and not per-user JWT. Rate limit is still a proxy concern; outbound courier fan-out is already capped (`BULK_CONCURRENCY`, default 10).
- **Latency is the courier, not Express.** Create/track/cancel p50 follows UrbaneBolt (typically hundreds of ms to a few seconds). Health and `GET /couriers` are milliseconds. Retries can stretch a dead-courier call toward the timeout budget (~8s × 4 attempts).
- **Throughput.** Bulk of 100 at concurrency 10 is about `100 / 10 × courier_latency` wall-clock for the job; the client is not blocked. Unbounded `POST /orders` can exceed that cap — production would apply an inbound limit so UAT is not stampeded.
- **Next steps (not in this repo):** durable queue, proxy rate limit, GitHub Actions wrapping `npm test`, webhook-based tracking instead of pull-on-GET.

## What we did not build

Label print, NDR, pay-mode change, ePOD — present in UrbaneBolt docs, out of the required subset (auth, create, track, cancel). GitHub Actions and load tests were left out of the 2-day scope on purpose (see Tests above for CI).
