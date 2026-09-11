import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
