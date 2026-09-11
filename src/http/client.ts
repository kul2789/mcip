import { courierUnavailable } from "../errors";
import { logger } from "../logger";

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  requestId?: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  ok: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

export async function httpRequest(req: HttpRequest, fetchImpl: typeof fetch = fetch): Promise<HttpResponse> {
  let lastError: unknown;
  const attempts = Math.max(1, req.retryCount + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetchImpl(req.url, {
        method: req.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(req.requestId ? { "X-Request-Id": req.requestId } : {}),
          ...req.headers,
        },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown = text;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      } else {
        parsed = null;
      }

      if (isRetryableStatus(res.status) && attempt < attempts) {
        logger.warn({
          msg: "courier_http_retry",
          url: req.url,
          status: res.status,
          attempt,
          request_id: req.requestId,
        });
        await sleep(req.retryBackoffMs * attempt);
        continue;
      }

      return { status: res.status, body: parsed, ok: res.ok };
    } catch (err) {
      lastError = err;
      const aborted = err instanceof Error && err.name === "AbortError";
      logger.warn({
        msg: "courier_http_error",
        url: req.url,
        attempt,
        aborted,
        error_type: aborted ? "timeout" : "network",
        err: err instanceof Error ? err.message : String(err),
        request_id: req.requestId,
      });
      if (attempt < attempts) {
        await sleep(req.retryBackoffMs * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw courierUnavailable(
    lastError instanceof Error ? `Courier request failed: ${lastError.message}` : "Courier request failed",
  );
}
