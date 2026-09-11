import type { NextFunction, Request, Response } from "express";
import { AppError } from "../errors";
import { logger } from "../logger";
import { zodToFieldErrors } from "../validation/order";
import { ZodError } from "zod";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId ?? "unknown";

  if (err instanceof ZodError) {
    const mapped = new AppError("VALIDATION_ERROR", "Request validation failed", 400, zodToFieldErrors(err));
    res.status(400).json(errorBody(requestId, mapped));
    return;
  }

  if (err instanceof AppError) {
    if (err.httpStatus >= 500) {
      logger.error({
        msg: "request_error",
        request_id: requestId,
        error_type: err.code,
        err: err.message,
        stack: err.stack,
        path: req.path,
      });
    }
    res.status(err.httpStatus).json(errorBody(requestId, err));
    return;
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error({
    msg: "unhandled_error",
    request_id: requestId,
    error_type: "INTERNAL_ERROR",
    err: error.message,
    stack: error.stack,
    path: req.path,
  });
  res.status(500).json({
    success: false,
    request_id: requestId,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
  });
}

function errorBody(requestId: string, err: AppError) {
  return {
    success: false as const,
    request_id: requestId,
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
  };
}
