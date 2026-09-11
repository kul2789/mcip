import fs from "node:fs";
import mysql from "mysql2/promise";
import { config } from "../config";
import { schemaFile } from "./mysqlRepo";

async function migrate(): Promise<void> {
  const conn = await mysql.createConnection({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    multipleStatements: true,
  });

  const sql = fs.readFileSync(schemaFile(), "utf8");
  await conn.query(sql);
  await conn.end();
  // eslint-disable-next-line no-console
  console.log("MySQL schema applied.");
}

migrate().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Migration failed:", err);
  process.exit(1);
});
