import mysql from "mysql2/promise";
import { config } from "../config";

export function createPool(): mysql.Pool {
  return mysql.createPool({
    host: config.MYSQL_HOST,
    port: config.MYSQL_PORT,
    user: config.MYSQL_USER,
    password: config.MYSQL_PASSWORD,
    database: config.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: "Z",
  });
}

export async function pingPool(pool: mysql.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
