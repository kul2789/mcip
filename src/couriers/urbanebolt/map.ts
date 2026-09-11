import type { Address, CreateOrderInput } from "../../types";

export interface UrbaneBoltManifestItem {
  customerCode: string;
  orderNumber: string;
  declaredValue: number;
  itemDescription: string;
  collectableValue: number;
  height: number;
  length: number;
  pieces: number;
  weight: number;
  breadth: number;
  serviceType: string;
  payMode: "COD" | "PPD";
  rtnCity: string;
  rtnName: string;
  consCity: string;
  consName: string;
  rtnEmail: string;
  rtnState: string;
  shprCity: string;
  shprName: string;
  consEmail: string;
  consState: string;
  rtnMobile: number;
  shprEmail: string;
  shprState: string;
  consMobile: number;
  rtnAddress: string;
  rtnAddressType: string;
  rtnCountry: string;
  rtnPincode: number;
  shprMobile: number;
  consAddress: string;
  consAddressType: string;
  consCountry: string;
  consPincode: number;
  invoiceNumber: string;
  invoiceDate: string;
  shprAddress: string;
  shprAddressType: string;
  shprCountry: string;
  shprPincode: number;
  invoiceValue: number;
  itemQuantity: number;
}

function digits(value: string): number {
  return Number(value.replace(/\D/g, "")) || 0;
}

function joinAddress(addr: Address): string {
  return [addr.address_line1, addr.address_line2].filter(Boolean).join(", ");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toManifestPayload(
  input: CreateOrderInput,
  customerCode: string,
): UrbaneBoltManifestItem[] {
  const pickup = input.pickup;
  const delivery = input.delivery;
  const rtn = input.return_address ?? pickup;
  const qty = input.package.items.reduce((sum, item) => sum + item.qty, 0);
  const declared = input.package.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const description = input.package.items.map((item) => item.name).join(", ");
  const collectable = input.payment_mode === "COD" ? Number(input.cod_amount ?? 0) : 0;

  return [
    {
      customerCode,
      orderNumber: input.order_id,
      declaredValue: declared,
      itemDescription: description,
      collectableValue: collectable,
      height: input.package.height_cm,
      length: input.package.length_cm,
      pieces: 1,
      weight: Math.max(input.package.weight_grams / 1000, 0.1),
      breadth: input.package.width_cm,
      serviceType: input.service_type ?? "NDD",
      payMode: input.payment_mode === "COD" ? "COD" : "PPD",
      rtnCity: rtn.city,
      rtnName: rtn.name,
      consCity: delivery.city,
      consName: delivery.name,
      rtnEmail: rtn.email ?? "",
      rtnState: rtn.state,
      shprCity: pickup.city,
      shprName: pickup.name,
      consEmail: delivery.email ?? "",
      consState: delivery.state,
      rtnMobile: digits(rtn.phone),
      shprEmail: pickup.email ?? "",
      shprState: pickup.state,
      consMobile: digits(delivery.phone),
      rtnAddress: joinAddress(rtn),
      rtnAddressType: "Seller",
      rtnCountry: rtn.country,
      rtnPincode: digits(rtn.pincode),
      shprMobile: digits(pickup.phone),
      consAddress: joinAddress(delivery),
      consAddressType: "Home",
      consCountry: delivery.country,
      consPincode: digits(delivery.pincode),
      invoiceNumber: input.invoice_number ?? `INV-${input.order_id}`,
      invoiceDate: today(),
      shprAddress: joinAddress(pickup),
      shprAddressType: "Seller",
      shprCountry: pickup.country,
      shprPincode: digits(pickup.pincode),
      invoiceValue: declared,
      itemQuantity: qty,
    },
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

export function extractToken(body: unknown): string | undefined {
  const root = asRecord(body);
  if (!root) return undefined;
  const data = asRecord(root.data) ?? asRecord(root.result) ?? asRecord(root.payload);
  return firstString(
    root.token,
    root.access,
    root.access_token,
    root.authToken,
    root.Token,
    data?.token,
    data?.access,
    data?.access_token,
  );
}

function unwrapList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
  }
  const root = asRecord(body);
  if (!root) return [];
  for (const key of ["successResponse", "data", "result", "results", "shipments", "orders"]) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.filter((item) => item && typeof item === "object") as Record<string, unknown>[];
    }
    const nested = asRecord(value);
    if (nested) return [nested];
  }
  return [root];
}

export function extractAwb(body: unknown, orderNumber: string): { awb: string; shipmentId: string } {
  const rows = unwrapList(body);
  const match =
    rows.find((row) => firstString(row.orderNumber, row.order_number, row.orderId) === orderNumber) ??
    rows[0] ??
    {};
  const awb = firstString(
    match.awb,
    match.awbNumber,
    match.awb_number,
    match.AWB,
    match.docket,
    match.docketNo,
    match.trackingNumber,
  );
  const shipmentId = firstString(
    match.shipmentId,
    match.shipment_id,
    match.consignmentId,
    match.id,
    match.docketNo,
    awb,
  );
  if (!awb) {
    throw new Error("UrbaneBolt response did not include an AWB");
  }
  return { awb, shipmentId: shipmentId ?? awb };
}

export function courierMessage(body: unknown, fallback: string): string {
  const root = asRecord(body);
  if (!root) return fallback;
  const errors = root.errorResponse ?? root.failureResponse;
  const firstError = Array.isArray(errors) && asRecord(errors[0]);
  const msg = firstString(
    root.message,
    root.error,
    root.detail,
    firstError?.message,
    firstError?.error,
    asRecord(root.data)?.message,
  );
  return msg ?? fallback;
}

export function isCourierSuccess(status: number, body: unknown): boolean {
  if (status >= 400) return false;
  const root = asRecord(body);
  if (!root) return status >= 200 && status < 300;
  if (root.success === false || root.status === false || root.error === true) return false;
  const flag = firstString(root.status, root.result);
  if (flag && /fail|error/i.test(flag)) return false;
  if (Array.isArray(root.errorResponse) && root.errorResponse.length > 0 && (!Array.isArray(root.successResponse) || root.successResponse.length === 0)) {
    return false;
  }
  return true;
}
