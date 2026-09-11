# DESIGN.md

## Problem

Internal systems (OMS, frontend) must talk to many courier partners through **one API**. UrbaneBolt is the first live integration; Delhivery / Shiprocket / Bluedart must be addable later **without editing controllers, DTOs, or existing adapters**.

## Pattern: Strategy + Adapter + Registry

```
HTTP controllers  →  OrderService  →  CourierRegistry.get(partner)  →  CourierPort
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
| `VALIDATION_ERROR` | 400 |
| `UNSUPPORTED_COURIER` | 400 |
| `ORDER_NOT_FOUND` | 404 |
| `CANCELLATION_NOT_ALLOWED` | 409 |
| `COURIER_REJECTED` | 422 |
| `COURIER_UNAVAILABLE` | 502 |

Logs always include `order_id`, `courier_partner`, `request_id`, `error_type`, and stack where useful.

## Config

API keys, base URLs, timeouts, retry counts, bulk concurrency, and UrbaneBolt `customerCode` come from environment variables only.

## What we did not build

Label print, NDR, pay-mode change, ePOD — present in UrbaneBolt docs, out of the required subset (auth, create, track, cancel).
