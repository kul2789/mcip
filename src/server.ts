import { createApp } from "./app";
import { config } from "./config";
import { createDefaultRegistry } from "./couriers";
import { logger } from "./logger";
import { createPool } from "./db/pool";
import { MysqlOrdersRepository, ensureSchema } from "./db/mysqlRepo";

async function main(): Promise<void> {
  const pool = createPool();
  await ensureSchema(pool);
  const app = createApp({
    repo: new MysqlOrdersRepository(pool),
    registry: createDefaultRegistry(),
    pool,
  });

  app.listen(config.PORT, () => {
    logger.info({
      msg: "mcip_started",
      port: config.PORT,
      docs: `http://localhost:${config.PORT}/api/docs`,
      couriers: ["urbanebolt", "mock"],
    });
  });
}

main().catch((err) => {
  logger.fatal({ msg: "startup_failed", err: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
