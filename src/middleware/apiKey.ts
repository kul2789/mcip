import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { unauthorized } from "../errors";

function matches(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** No-op when expectedKey is empty so local/tests/demo stay open. */
export function requireApiKey(expectedKey: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!expectedKey) {
      next();
      return;
    }
    const provided = req.header("x-api-key") ?? "";
    if (!matches(expectedKey, provided)) {
      next(unauthorized());
      return;
    }
    next();
  };
}
