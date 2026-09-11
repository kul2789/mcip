export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNSUPPORTED_COURIER"
  | "ORDER_NOT_FOUND"
  | "BATCH_NOT_FOUND"
  | "CANCELLATION_NOT_ALLOWED"
  | "COURIER_REJECTED"
  | "COURIER_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface FieldError {
  field: string;
  issue: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: FieldError[] | Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: number,
    details?: FieldError[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export function validationError(details: FieldError[]): AppError {
  return new AppError("VALIDATION_ERROR", "Request validation failed", 400, details);
}

export function unsupportedCourier(partner: string, supported: string[]): AppError {
  return new AppError(
    "UNSUPPORTED_COURIER",
    `Unknown courier_partner '${partner}'`,
    400,
    { supported },
  );
}

export function orderNotFound(orderId: string): AppError {
  return new AppError("ORDER_NOT_FOUND", `Order '${orderId}' was not found`, 404);
}

export function batchNotFound(batchId: string): AppError {
  return new AppError("BATCH_NOT_FOUND", `Batch '${batchId}' was not found`, 404);
}

export function courierRejected(message: string): AppError {
  return new AppError("COURIER_REJECTED", message, 422);
}

export function courierUnavailable(message = "Courier is temporarily unavailable"): AppError {
  return new AppError("COURIER_UNAVAILABLE", message, 502);
}
