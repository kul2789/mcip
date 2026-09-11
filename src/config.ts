import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["silent", "fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  NODE_ENV: z.string().default("development"),

  MYSQL_HOST: z.string().default("127.0.0.1"),
  MYSQL_PORT: z.coerce.number().int().positive().default(3306),
  MYSQL_USER: z.string().default("mcip"),
  MYSQL_PASSWORD: z.string().default("mcip"),
  MYSQL_DATABASE: z.string().default("mcip"),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  HTTP_RETRY_COUNT: z.coerce.number().int().min(0).max(8).default(3),
  HTTP_RETRY_BACKOFF_MS: z.coerce.number().int().min(0).default(300),
  BULK_CONCURRENCY: z.coerce.number().int().positive().max(50).default(10),

  URBANEBOLT_BASE_URL: z.string().url().default("https://uat.urbanebolt.in"),
  URBANEBOLT_USERNAME: z.string().default(""),
  URBANEBOLT_PASSWORD: z.string().default(""),
  URBANEBOLT_CUSTOMER_CODE: z.string().default("UEBCUS0008"),
  URBANEBOLT_CSRF_TOKEN: z.string().default(""),
});

export const config = EnvSchema.parse(process.env);

export const isTest = config.NODE_ENV === "test";
