import cors from "cors";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import swaggerUi from "swagger-ui-express";
import type { CourierRegistry } from "./couriers/registry";
import type { OrdersRepository } from "./db/mysqlRepo";
import { config } from "./config";
import { pingPool } from "./db/pool";
import type { Pool } from "mysql2/promise";
import { requireApiKey } from "./middleware/apiKey";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { openApiSpec } from "./openapi";
import { createBatchRouter, createCourierRouter, createOrderRouter } from "./routes/orders";
import { BulkService } from "./services/bulk";
import { OrderService } from "./services/orders";

export interface AppDeps {
  repo: OrdersRepository;
  registry: CourierRegistry;
  pool?: Pool;
  /** Override `MCIP_API_KEY`. Empty / omitted disables the check. */
  apiKey?: string;
}

export function createApp(deps: AppDeps): Express {
  const orders = new OrderService(deps.repo, deps.registry);
  const bulk = new BulkService(deps.repo, orders, config.BULK_CONCURRENCY);

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(requestId);

  const apiKey = deps.apiKey ?? config.MCIP_API_KEY;
  app.use("/api/v1", requireApiKey(apiKey));

  app.get("/health", async (_req: Request, res: Response) => {
    const mysql = deps.pool ? ((await pingPool(deps.pool)) ? "up" : "down") : "memory";
    res.json({ status: mysql === "down" ? "degraded" : "ok", mysql });
  });

  app.get("/api/docs.json", (_req: Request, res: Response) => {
    res.json(openApiSpec);
  });
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: "MCIP API" }));

  app.use("/api/v1/orders", createOrderRouter(orders, bulk));
  app.use("/api/v1/batches", createBatchRouter(bulk));
  app.use("/api/v1/couriers", createCourierRouter(orders));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      request_id: _req.requestId,
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });

  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    errorHandler(err, req, res, next);
  });

  return app;
}
