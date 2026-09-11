import type { Pool, RowDataPacket } from "mysql2/promise";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  BatchStatus,
  BulkJob,
  BulkOrderResult,
  OrderRecord,
  ShipmentStatus,
  TrackingRow,
} from "../types";

export interface InsertOrderInput {
  id: string;
  order_id: string;
  courier_partner: string;
  status: ShipmentStatus;
  request_payload: unknown;
}

export interface OrdersRepository {
  findByOrderId(orderId: string): Promise<OrderRecord | null>;
  insertIfAbsent(input: InsertOrderInput): Promise<"inserted" | "duplicate">;
  updateAfterCourier(input: {
    order_id: string;
    courier_shipment_id: string | null;
    awb_number: string | null;
    status: ShipmentStatus;
    response_payload: unknown;
    failure_reason?: string | null;
  }): Promise<void>;
  appendTracking(input: {
    order_id: string;
    status: ShipmentStatus;
    description?: string | null;
    location?: string | null;
    raw_payload: unknown;
  }): Promise<void>;
  listTracking(orderId: string): Promise<TrackingRow[]>;
  createBatch(input: { batch_id: string; total: number; results: BulkOrderResult[] }): Promise<void>;
  getBatch(batchId: string): Promise<BulkJob | null>;
  saveBatch(job: BulkJob): Promise<void>;
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return new Date().toISOString();
}

function mapOrder(row: RowDataPacket): OrderRecord {
  return {
    id: String(row.id),
    order_id: String(row.order_id),
    courier_partner: String(row.courier_partner),
    courier_shipment_id: row.courier_shipment_id ? String(row.courier_shipment_id) : null,
    awb_number: row.awb_number ? String(row.awb_number) : null,
    status: row.status as ShipmentStatus,
    request_payload: parseJson(row.request_payload),
    response_payload: parseJson(row.response_payload),
    failure_reason: row.failure_reason ? String(row.failure_reason) : null,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export class MysqlOrdersRepository implements OrdersRepository {
  constructor(private readonly pool: Pool) {}

  async findByOrderId(orderId: string): Promise<OrderRecord | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM orders WHERE order_id = ? LIMIT 1",
      [orderId],
    );
    return rows[0] ? mapOrder(rows[0]) : null;
  }

  async insertIfAbsent(input: InsertOrderInput): Promise<"inserted" | "duplicate"> {
    try {
      await this.pool.query(
        `INSERT INTO orders (id, order_id, courier_partner, status, request_payload)
         VALUES (?, ?, ?, ?, ?)`,
        [input.id, input.order_id, input.courier_partner, input.status, json(input.request_payload)],
      );
      return "inserted";
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ER_DUP_ENTRY") return "duplicate";
      throw err;
    }
  }

  async updateAfterCourier(input: {
    order_id: string;
    courier_shipment_id: string | null;
    awb_number: string | null;
    status: ShipmentStatus;
    response_payload: unknown;
    failure_reason?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE orders
          SET courier_shipment_id = ?,
              awb_number = ?,
              status = ?,
              response_payload = ?,
              failure_reason = ?
        WHERE order_id = ?`,
      [
        input.courier_shipment_id,
        input.awb_number,
        input.status,
        json(input.response_payload),
        input.failure_reason ?? null,
        input.order_id,
      ],
    );
  }

  async appendTracking(input: {
    order_id: string;
    status: ShipmentStatus;
    description?: string | null;
    location?: string | null;
    raw_payload: unknown;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO tracking_events (id, order_id, status, description, location, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.order_id,
        input.status,
        input.description ?? null,
        input.location ?? null,
        json(input.raw_payload),
      ],
    );
  }

  async listTracking(orderId: string): Promise<TrackingRow[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM tracking_events WHERE order_id = ? ORDER BY recorded_at ASC",
      [orderId],
    );
    return rows.map((row) => ({
      id: String(row.id),
      order_id: String(row.order_id),
      status: row.status as ShipmentStatus,
      description: row.description ? String(row.description) : null,
      location: row.location ? String(row.location) : null,
      raw_payload: parseJson(row.raw_payload),
      recorded_at: toIso(row.recorded_at),
    }));
  }

  async createBatch(input: {
    batch_id: string;
    total: number;
    results: BulkOrderResult[];
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO bulk_jobs (batch_id, status, total, succeeded, failed, results)
       VALUES (?, ?, ?, 0, 0, ?)`,
      [input.batch_id, "QUEUED", input.total, json(input.results)],
    );
  }

  async getBatch(batchId: string): Promise<BulkJob | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM bulk_jobs WHERE batch_id = ? LIMIT 1",
      [batchId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      batch_id: String(row.batch_id),
      status: row.status as BatchStatus,
      total: Number(row.total),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed),
      results: (parseJson(row.results) as BulkOrderResult[]) ?? [],
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }

  async saveBatch(job: BulkJob): Promise<void> {
    await this.pool.query(
      `UPDATE bulk_jobs
          SET status = ?, succeeded = ?, failed = ?, results = ?
        WHERE batch_id = ?`,
      [job.status, job.succeeded, job.failed, json(job.results), job.batch_id],
    );
  }
}

export function schemaFile(): string {
  const candidates = [
    path.join(__dirname, "schema.sql"),
    path.join(process.cwd(), "src/db/schema.sql"),
  ];
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) throw new Error("schema.sql not found");
  return found;
}

export async function ensureSchema(pool: Pool): Promise<void> {
  const sql = fs.readFileSync(schemaFile(), "utf8");
  const statements = sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
}
