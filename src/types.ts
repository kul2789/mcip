export const SHIPMENT_STATUSES = [
  "CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "CANCELLED",
  "FAILED",
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const PAYMENT_MODES = ["PREPAID", "COD"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export interface Address {
  name: string;
  phone: string;
  email?: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
}

export interface PackageItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface PackageInfo {
  weight_grams: number;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  items: PackageItem[];
}

export interface CreateOrderInput {
  order_id: string;
  courier_partner: string;
  payment_mode: PaymentMode;
  cod_amount?: number;
  service_type?: string;
  invoice_number?: string;
  pickup: Address;
  delivery: Address;
  return_address?: Address;
  package: PackageInfo;
}

export interface NormalizedShipment {
  courier_shipment_id: string;
  awb_number: string;
  status: ShipmentStatus;
  raw_request: unknown;
  raw_response: unknown;
}

export interface TrackingEvent {
  status: ShipmentStatus;
  description: string;
  location?: string;
  timestamp: string;
  raw: unknown;
}

export interface NormalizedTracking {
  awb_number: string;
  status: ShipmentStatus;
  current: TrackingEvent;
  history: TrackingEvent[];
  raw_response: unknown;
}

export interface NormalizedCancel {
  awb_number: string;
  status: "CANCELLED";
  raw_request: unknown;
  raw_response: unknown;
}

export interface TrackingRef {
  order_id: string;
  awb_number: string;
  courier_shipment_id?: string | null;
}

export interface CancelRef {
  order_id: string;
  awb_number: string;
  reason?: string;
}

export interface OrderRecord {
  id: string;
  order_id: string;
  courier_partner: string;
  courier_shipment_id: string | null;
  awb_number: string | null;
  status: ShipmentStatus;
  request_payload: unknown;
  response_payload: unknown;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingRow {
  id: string;
  order_id: string;
  status: ShipmentStatus;
  description: string | null;
  location: string | null;
  raw_payload: unknown;
  recorded_at: string;
}

export type BatchStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "PARTIAL";

export interface BulkOrderResult {
  order_id: string;
  success: boolean;
  courier_partner: string;
  awb_number?: string;
  status?: ShipmentStatus;
  idempotent_replay?: boolean;
  error?: { code: string; message: string };
}

export interface BulkJob {
  batch_id: string;
  status: BatchStatus;
  total: number;
  succeeded: number;
  failed: number;
  results: BulkOrderResult[];
  created_at: string;
  updated_at: string;
}
