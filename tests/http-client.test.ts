import { describe, expect, it, vi } from "vitest";
import { httpRequest } from "../src/http/client";
import { AppError } from "../src/errors";

describe("http client", () => {
  it("retries 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await httpRequest(
      {
        url: "https://example.test/x",
        timeoutMs: 500,
        retryCount: 2,
        retryBackoffMs: 1,
      },
      fetchImpl as unknown as typeof fetch,
    );

    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails after retries on network errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    await expect(
      httpRequest(
        {
          url: "https://example.test/x",
          timeoutMs: 50,
          retryCount: 1,
          retryBackoffMs: 1,
        },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ code: "COURIER_UNAVAILABLE", httpStatus: 502 } satisfies Partial<AppError>);
  });
});
