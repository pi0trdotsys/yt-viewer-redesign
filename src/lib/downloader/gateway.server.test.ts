import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../auth/types.shared";

const getSessionUser = vi.fn<(request: Request) => Promise<SessionUser | null>>();
vi.mock("../auth/session.server", () => ({
  getSessionUser: (request: Request) => getSessionUser(request),
}));

const ALICE: SessionUser = { id: "alice", name: "Alice", accent: "primary", role: "user" };

describe("handleDownloaderApi", () => {
  const originalFetch = global.fetch;
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env["WORKER_TOKEN"] = "test-worker-token";
    process.env["WORKER_URL"] = "http://worker.internal:8081";
    getSessionUser.mockReset();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env["WORKER_TOKEN"];
    delete process.env["WORKER_URL"];
    global.fetch = originalFetch;
  });

  it("GET /api/health jest zawsze publiczny", async () => {
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(new Request("http://localhost/api/health"));
    expect(res?.status).toBe(200);
    expect(getSessionUser).not.toHaveBeenCalled();
  });

  it("zwraca null dla ścieżek spoza gatewayu", async () => {
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(new Request("http://localhost/api/auth/session"));
    expect(res).toBeNull();
  });

  it("bez sesji → 401, worker nie wołany", async () => {
    getSessionUser.mockResolvedValue(null);
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(new Request("http://localhost/api/public/streams"));
    expect(res?.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("przekazuje żądanie do workera z Bearer token i X-User-Id", async () => {
    getSessionUser.mockResolvedValue(ALICE);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(
      new Request("http://localhost/api/public/streams/abc-123?token=xyz"),
    );
    expect(res?.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://worker.internal:8081/streams/abc-123?token=xyz");
    const headers = init.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer test-worker-token");
    expect(headers.get("x-user-id")).toBe("alice");
  });

  it("przekazuje body dla POST i zachowuje content-type", async () => {
    getSessionUser.mockResolvedValue(ALICE);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));

    const { handleDownloaderApi } = await import("./gateway.server");
    await handleDownloaderApi(
      new Request("http://localhost/api/public/streams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://youtube.com/watch?v=x",
          format: "mp3",
          quality: "320kbps",
        }),
      }),
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toContain("youtube.com");
    const headers = init.headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("body ponad 64KB → 413, worker nie wołany", async () => {
    getSessionUser.mockResolvedValue(ALICE);
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(
      new Request("http://localhost/api/public/streams", {
        method: "POST",
        body: "x".repeat(64 * 1024 + 1),
      }),
    );
    expect(res?.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brak WORKER_TOKEN → 503", async () => {
    delete process.env["WORKER_TOKEN"];
    getSessionUser.mockResolvedValue(ALICE);
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(new Request("http://localhost/api/public/streams"));
    expect(res?.status).toBe(503);
  });

  it("worker nieosiągalny → 502", async () => {
    getSessionUser.mockResolvedValue(ALICE);
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const { handleDownloaderApi } = await import("./gateway.server");
    const res = await handleDownloaderApi(new Request("http://localhost/api/public/streams"));
    expect(res?.status).toBe(502);
  });
});
