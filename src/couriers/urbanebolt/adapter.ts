import { config } from "../../config";
import { AppError, courierRejected, courierUnavailable } from "../../errors";
import { httpRequest } from "../../http/client";
import { logger } from "../../logger";
import type {
  CancelRef,
  CreateOrderInput,
  NormalizedCancel,
  NormalizedShipment,
  NormalizedTracking,
  TrackingEvent,
  TrackingRef,
} from "../../types";
import type { CourierPort } from "../port";
import { mapCourierStatus } from "../status";
import {
  courierMessage,
  extractAwb,
  extractToken,
  isCourierSuccess,
  toManifestPayload,
} from "./map";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export interface UrbaneBoltOptions {
  baseUrl: string;
  username: string;
  password: string;
  customerCode: string;
  csrfToken?: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
}

export class UrbaneBoltAdapter implements CourierPort {
  readonly partner = "urbanebolt";
  private token: string | null = null;
  private readonly options: UrbaneBoltOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch, options?: Partial<UrbaneBoltOptions>) {
    this.fetchImpl = fetchImpl;
    this.options = {
      baseUrl: config.URBANEBOLT_BASE_URL,
      username: config.URBANEBOLT_USERNAME,
      password: config.URBANEBOLT_PASSWORD,
      customerCode: config.URBANEBOLT_CUSTOMER_CODE,
      csrfToken: config.URBANEBOLT_CSRF_TOKEN,
      timeoutMs: config.HTTP_TIMEOUT_MS,
      retryCount: config.HTTP_RETRY_COUNT,
      retryBackoffMs: config.HTTP_RETRY_BACKOFF_MS,
      ...options,
    };
  }

  private extraHeaders(auth?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = auth;
    if (this.options.csrfToken) headers.Cookie = `csrftoken=${this.options.csrfToken}`;
    return headers;
  }

  async createShipment(input: CreateOrderInput): Promise<NormalizedShipment> {
    const payload = toManifestPayload(input, this.options.customerCode);
    const response = await this.authorized("/api/v1/services/manifest/", {
      method: "POST",
      body: payload,
      orderId: input.order_id,
    });

    if (!isCourierSuccess(response.status, response.body)) {
      throw this.mapError(response.status, response.body, "Failed to create shipment");
    }

    let extracted: { awb: string; shipmentId: string };
    try {
      extracted = extractAwb(response.body, input.order_id);
    } catch {
      throw courierRejected("Courier did not return a tracking number");
    }

    return {
      courier_shipment_id: extracted.shipmentId,
      awb_number: extracted.awb,
      status: "CREATED",
      raw_request: payload,
      raw_response: response.body,
    };
  }

  async track(ref: TrackingRef): Promise<NormalizedTracking> {
    const response = await this.authorized(
      `/api/v1/services/tracking-pub/?awb=${encodeURIComponent(ref.awb_number)}`,
      { method: "GET", orderId: ref.order_id },
    );

    if (!isCourierSuccess(response.status, response.body)) {
      throw this.mapError(response.status, response.body, "Failed to track shipment");
    }

    const events = this.parseTracking(response.body, ref.awb_number);
    const current = events[events.length - 1] ?? {
      status: "CREATED" as const,
      description: "No tracking events yet",
      timestamp: new Date().toISOString(),
      raw: response.body,
    };

    return {
      awb_number: ref.awb_number,
      status: current.status,
      current,
      history: events,
      raw_response: response.body,
    };
  }

  async cancel(ref: CancelRef): Promise<NormalizedCancel> {
    const payload = { awbs: ref.awb_number };
    const response = await this.authorized("/api/v1/services/cancel/", {
      method: "POST",
      body: payload,
      orderId: ref.order_id,
    });

    if (!isCourierSuccess(response.status, response.body)) {
      throw this.mapError(response.status, response.body, "Failed to cancel shipment");
    }

    return {
      awb_number: ref.awb_number,
      status: "CANCELLED",
      raw_request: payload,
      raw_response: response.body,
    };
  }

  private parseTracking(body: unknown, awb: string): TrackingEvent[] {
    const root = asRecord(body);
    const data = asRecord(root?.data) ?? asRecord(root?.result) ?? root;
    const historyRaw =
      (Array.isArray(data?.history) && data?.history) ||
      (Array.isArray(data?.scans) && data?.scans) ||
      (Array.isArray(data?.trackingHistory) && data?.trackingHistory) ||
      (Array.isArray(root?.history) && root?.history) ||
      [];

    const events: TrackingEvent[] = historyRaw
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const rawStatus = String(
          item.statusCodeDescription ??
            item.description ??
            item.status ??
            item.scan ??
            item.event ??
            item.statusCode ??
            "IN_TRANSIT",
        );
        return {
          status: mapCourierStatus(rawStatus),
          description: String(item.statusCodeDescription ?? item.description ?? item.remarks ?? item.status ?? rawStatus),
          location: item.currentLocation ? String(item.currentLocation) : item.location ? String(item.location) : undefined,
          timestamp: String(
            item.statusDateTime ?? item.timestamp ?? item.time ?? item.date ?? new Date().toISOString(),
          ),
          raw: item,
        };
      });

    if (events.length === 0) {
      const rawStatus = String(
        data?.currentStatusCodeDescription ?? data?.status ?? data?.currentStatus ?? data?.shipmentStatus ?? "CREATED",
      );
      events.push({
        status: mapCourierStatus(rawStatus),
        description: rawStatus,
        timestamp: new Date().toISOString(),
        raw: body,
      });
    }

    void awb;
    return events;
  }

  private async authorized(
    path: string,
    opts: { method: string; body?: unknown; orderId?: string },
  ) {
    const token = await this.getToken(false, opts.orderId);
    const first = await this.call(path, opts, token);
    if (first.status !== 401) return first;

    logger.warn({
      msg: "urbanebolt_reauth",
      order_id: opts.orderId,
      courier_partner: this.partner,
    });
    this.token = null;
    const refreshed = await this.getToken(true, opts.orderId);
    return this.call(path, opts, refreshed);
  }

  private async getToken(force: boolean, orderId?: string): Promise<string> {
    if (this.token && !force) return this.token;
    const url = `${this.options.baseUrl.replace(/\/$/, "")}/api/v1/auth/getToken/`;
    const response = await httpRequest(
      {
        url,
        method: "POST",
        headers: this.extraHeaders(),
        body: { username: this.options.username, password: this.options.password },
        timeoutMs: this.options.timeoutMs,
        retryCount: this.options.retryCount,
        retryBackoffMs: this.options.retryBackoffMs,
      },
      this.fetchImpl,
    );

    if (!response.ok) {
      logger.error({
        msg: "urbanebolt_auth_failed",
        order_id: orderId,
        courier_partner: this.partner,
        status: response.status,
        error_type: "auth",
      });
      throw this.mapError(response.status, response.body, "Courier authentication failed");
    }

    const token = extractToken(response.body);
    if (!token) {
      throw courierUnavailable("Courier authentication did not return a token");
    }
    this.token = token;
    return token;
  }

  private async call(
    path: string,
    opts: { method: string; body?: unknown; orderId?: string },
    token: string,
  ) {
    const url = `${this.options.baseUrl.replace(/\/$/, "")}${path}`;
    return httpRequest(
      {
        url,
        method: opts.method,
        body: opts.body,
        headers: this.extraHeaders(`Bearer ${token}`),
        timeoutMs: this.options.timeoutMs,
        retryCount: this.options.retryCount,
        retryBackoffMs: this.options.retryBackoffMs,
        requestId: opts.orderId,
      },
      this.fetchImpl,
    );
  }

  private mapError(status: number, body: unknown, fallback: string): AppError {
    const message = courierMessage(body, fallback);
    if (status >= 500 || status === 0) return courierUnavailable(message);
    return courierRejected(message);
  }
}
