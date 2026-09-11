# MCIP — Multi-Courier Integration Platform

Backend service that exposes **one courier-agnostic REST API**. Internal consumers pass `courier_partner`; adapters talk to UrbaneBolt UAT (and a MockCourier used to prove plug-in design).

## Stack

Express + TypeScript + Zod + MySQL 8 (`mysql2`) + native `fetch`. No Nest, Prisma, Redis, or BullMQ.

## Hosted demo

- Swagger: https://mcip.kavyaretail.in/api/docs
- Health: https://mcip.kavyaretail.in/health
- Couriers: https://mcip.kavyaretail.in/api/v1/couriers
- OpenAPI JSON: https://mcip.kavyaretail.in/api/docs.json

The demo stays open unless `MCIP_API_KEY` is set on the server. Use `"courier_partner": "mock"` in Swagger to try create/track/cancel without hitting UAT. If a key is enabled, click **Authorize** and paste `X-Api-Key`. `/health` and `/api/docs` never require it.

## Quick start

```bash
# 1. MySQL
docker compose up -d mysql

# 2. Install
npm install

# 3. Env
cp .env.example .env
# set URBANEBOLT_USERNAME / URBANEBOLT_PASSWORD from the assignment UAT docs

# 4. Schema (also applied automatically on npm start)
npm run db:migrate

# 5. Run
npm run dev
```

- API: http://localhost:3000  
- Swagger: http://localhost:3000/api/docs  
- OpenAPI JSON: http://localhost:3000/api/docs.json  
- Health: http://localhost:3000/health  

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `LOG_LEVEL` | pino level | `info` |
| `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` | MySQL | `127.0.0.1` / `3306` / `mcip` / `mcip` / `mcip` |
| `HTTP_TIMEOUT_MS` | Courier HTTP timeout | `8000` |
| `HTTP_RETRY_COUNT` | Retries after timeout/5xx | `3` |
| `HTTP_RETRY_BACKOFF_MS` | Linear backoff base | `300` |
| `BULK_CONCURRENCY` | Max parallel courier calls in a batch | `10` |
| `MCIP_API_KEY` | Consumer key for `/api/v1/*` (`X-Api-Key` header). Empty = auth off | empty |
| `URBANEBOLT_BASE_URL` | UAT host | `https://uat.urbanebolt.in` |
| `URBANEBOLT_USERNAME` | getToken username | — |
| `URBANEBOLT_PASSWORD` | getToken password | — |
| `URBANEBOLT_CUSTOMER_CODE` | Manifest `customerCode` | `UEBCUS0008` |
| `URBANEBOLT_CSRF_TOKEN` | Optional `Cookie: csrftoken=...` on UAT calls (from Postman docs) | empty |

Never commit `.env`. `.env.example` has placeholders only.

## How to run tests

```bash
npm install
npm test
```

**19 existing + 5 API-key tests, Vitest.** No `.env`, MySQL, or UrbaneBolt UAT required. The suite uses an in-memory repository + MockCourier, and a fake `fetch` for UrbaneBolt mapping/HTTP.

| File | Tests | What it checks |
|---|---|---|
| `tests/api.e2e.test.ts` | 5 | create → track → cancel, duplicate `order_id` → `200` + `idempotent_replay`, unknown courier `400`, pincode `000000` → `422` without leaking internals, bulk `202` + partial success |
| `tests/api-key.test.ts` | 5 | `X-Api-Key` off when unset; 401 missing/wrong; 201 with matching header; `/health` and docs stay open |
| `tests/validation.test.ts` | 4 | Zod on the unified body |
| `tests/registry.test.ts` | 2 | plug-in lookup / unsupported partner |
| `tests/urbanebolt-map.test.ts` | 4 | our DTO → UAT payload, AWB unwrap from `successResponse` |
| `tests/urbanebolt-adapter.test.ts` | 2 | adapter against mocked HTTP |
| `tests/http-client.test.ts` | 2 | timeout / 5xx retry with backoff |

Live UAT is exercised on the hosted demo (`courier_partner: "urbanebolt"`), not in GitHub Actions.

**Why there is no GitHub Action:** the assignment asked for a repo, README, and design doc — not a CI pipeline. The suite is already zero-infra (`npm test` on a clone), so Actions would only wrap that same command. Time went into the courier adapter, bulk contract, and a running demo instead of YAML. Adding `.github/workflows/test.yml` (`npm ci && npm test` on push) is a 10-line follow-up if they want a green badge.

## Unified API

When `MCIP_API_KEY` is set, all `/api/v1/*` routes require header `X-Api-Key`. `/health` and `/api/docs` stay public. Empty env (local default) leaves the API open so tests and the interview demo work without a header.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/orders` | Create shipment. Duplicate `order_id` → `200` + `idempotent_replay` |
| `GET` | `/api/v1/orders/{order_id}/track` | Poll courier, append-only history |
| `POST` | `/api/v1/orders/{order_id}/cancel` | Cancel before delivery |
| `POST` | `/api/v1/orders/bulk` | Max 100. Returns `202` + `batch_id` immediately |
| `GET` | `/api/v1/batches/{batch_id}` | Per-order success/failure |
| `GET` | `/api/v1/couriers` | Registered partners |
| `GET` | `/health` | Process + MySQL ping |
| `GET` | `/api/docs` | Swagger UI |

### Create example

```bash
curl -s http://localhost:3000/api/v1/orders \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: your-key-if-configured' \
  -d '{
    "order_id": "ORD-1001",
    "courier_partner": "mock",
    "payment_mode": "PREPAID",
    "pickup": {
      "name": "Warehouse A", "phone": "9876543210",
      "address_line1": "12 MG Road", "city": "Bengaluru",
      "state": "KA", "pincode": "560001", "country": "IN"
    },
    "delivery": {
      "name": "Rahul Sharma", "phone": "9123456780",
      "address_line1": "45 Park Street", "city": "Kolkata",
      "state": "WB", "pincode": "700016", "country": "IN"
    },
    "package": {
      "weight_grams": 500, "length_cm": 10, "width_cm": 8, "height_cm": 4,
      "items": [{ "sku": "SKU-1", "name": "T-shirt", "qty": 1, "price": 499 }]
    }
  }'
```

Use `"courier_partner": "urbanebolt"` for the real UAT adapter (UAT must be reachable).

Postman collection: `postman/mcip.postman_collection.json`.

## How to add a new courier

Adding Delhivery (or anyone else) must **not** change controllers, unified DTOs, OrderService, or existing adapters.

1. Create `src/couriers/delhivery/adapter.ts` implementing `CourierPort` (`createShipment`, `track`, `cancel`).
2. Map **our** `CreateOrderInput` → their payload inside that file only.
3. Register it:

```ts
// src/couriers/index.ts
new CourierRegistry([
  new UrbaneBoltAdapter(),
  new MockCourierAdapter(),
  new DelhiveryAdapter(), // add this
])
```

4. Add env vars (`DELHIVERY_BASE_URL`, API key, timeout).  
5. Clients send `"courier_partner": "delhivery"`.

That is the Strategy + Adapter + Registry pattern. See `DESIGN.md`.

## UrbaneBolt operations used

From [UAT Postman docs](https://bit.ly/ease-commerce-assignment):

| Operation | UrbaneBolt API |
|---|---|
| Auth | `POST /api/v1/auth/getToken/` |
| Create | `POST /api/v1/services/manifest/` |
| Track | `GET /api/v1/services/tracking-pub/?awb=` |
| Cancel | `POST /api/v1/services/cancel/` |

Token is cached. HTTP 401 triggers one re-login and retry. 5xx/timeout retry with backoff, then `COURIER_UNAVAILABLE` and the order is persisted as `FAILED`.

If `https://uat.urbanebolt.in` returns 503, create with `urbanebolt` fails after retries; `mock` still works.

## Assumptions

- Normalized statuses: `CREATED`, `PICKED_UP`, `IN_TRANSIT`, `DELIVERED`, `CANCELLED`, `FAILED`.
- Prepaid maps to UrbaneBolt `PPD`.
- Return address defaults to pickup.
- Bulk is an **in-process** queue (jobs are lost if the process dies). Production would swap in Redis/BullMQ without changing the HTTP contract.
- Duplicate `order_id` never creates a second shipment (MySQL unique key / memory map).
- Courier raw errors are never returned to API consumers.
- Consumer auth (`X-Api-Key`) is optional: off when `MCIP_API_KEY` is empty. It authenticates MCIP callers, not UrbaneBolt.
