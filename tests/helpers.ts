import type { CreateOrderInput } from "../src/types";

export function sampleOrder(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    order_id: "ORD-1001",
    courier_partner: "mock",
    payment_mode: "PREPAID",
    pickup: {
      name: "Warehouse A",
      phone: "9876543210",
      email: "wh@example.com",
      address_line1: "12 MG Road",
      city: "Bengaluru",
      state: "KA",
      pincode: "560001",
      country: "IN",
    },
    delivery: {
      name: "Rahul Sharma",
      phone: "9123456780",
      address_line1: "45 Park Street",
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
      items: [{ sku: "SKU-1", name: "T-shirt", qty: 1, price: 499 }],
    },
    ...overrides,
  };
}

export async function waitFor(
  fn: () => Promise<boolean> | boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("Timed out waiting for condition");
}
