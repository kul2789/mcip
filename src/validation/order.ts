import { z } from "zod";
import { validationError } from "../errors";
import type { CreateOrderInput } from "../types";

const phoneRegex = /^[0-9]{10}$/;
const pincodeRegex = /^[0-9]{6}$/;

const AddressSchema = z.object({
  name: z.string().min(1),
  phone: z.string().regex(phoneRegex, "must be 10 digits"),
  email: z.string().email().optional(),
  address_line1: z.string().min(1),
  address_line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().regex(pincodeRegex, "must be 6 digits"),
  country: z.string().min(2).default("IN"),
});

const PackageSchema = z.object({
  weight_grams: z.number().positive(),
  length_cm: z.number().positive(),
  width_cm: z.number().positive(),
  height_cm: z.number().positive(),
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        qty: z.number().int().positive(),
        price: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export const CreateOrderSchema = z
  .object({
    order_id: z.string().min(1).max(64),
    courier_partner: z.string().min(1).toLowerCase(),
    payment_mode: z.enum(["PREPAID", "COD"]),
    cod_amount: z.number().nonnegative().optional(),
    service_type: z.enum(["SDD", "NDD"]).optional(),
    invoice_number: z.string().min(1).optional(),
    pickup: AddressSchema,
    delivery: AddressSchema,
    return_address: AddressSchema.optional(),
    package: PackageSchema,
  })
  .superRefine((value, ctx) => {
    if (value.payment_mode === "COD" && (value.cod_amount === undefined || value.cod_amount <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cod_amount"],
        message: "cod_amount is required and must be > 0 for COD orders",
      });
    }
  });

export const BulkCreateSchema = z.object({
  orders: z.array(CreateOrderSchema).min(1).max(100),
});

export const CancelBodySchema = z.object({
  courier_partner: z.string().min(1).toLowerCase().optional(),
  reason: z.string().max(255).optional(),
});

export function zodToFieldErrors(err: z.ZodError): { field: string; issue: string }[] {
  return err.issues.map((issue) => ({
    field: issue.path.join(".") || "body",
    issue: issue.message,
  }));
}

export function parseCreateOrder(body: unknown): CreateOrderInput {
  const result = CreateOrderSchema.safeParse(body);
  if (!result.success) throw validationError(zodToFieldErrors(result.error));
  return result.data;
}

export function parseBulkCreate(body: unknown): CreateOrderInput[] {
  const result = BulkCreateSchema.safeParse(body);
  if (!result.success) throw validationError(zodToFieldErrors(result.error));
  return result.data.orders;
}

export function parseCancelBody(body: unknown): { courier_partner?: string; reason?: string } {
  const result = CancelBodySchema.safeParse(body ?? {});
  if (!result.success) throw validationError(zodToFieldErrors(result.error));
  return result.data;
}
