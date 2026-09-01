import { getSessionUser } from "../auth/session.server";

/**
 * Gateway /api/public/* → worker yt-dlp (Model A z kontraktu §1.1).
 * Kod wyłącznie serwerowy — używany przez `src/server.ts` (produkcja)
 * oraz dev-plugin w `vite.config.ts` (development).
 *
 * Zasady:
 * - czyta env wyłącznie wewnątrz funkcji (kontrakt §2),
 * - nie modyfikuje body/strumieni — SSE i pliki przepływają strumieniowo,
 * - autoryzacja żądań: sesja logowania (ciasteczko, `getSessionUser`) —
 *   sprawdzana tu, żeby działać identycznie w dev i produkcji. Token joba
 *   (`streamToken`) dodatkowo weryfikuje worker na endpointach /events i /files.
 */

const PUBLIC_PREFIX = "/api/public/";

function workerBaseUrl(): string {
  return (process.env["WORKER_URL"] ?? "http://127.0.0.1:8081").replace(/\/+$/, "");
}

function workerPath(request: Request): string {
  const url = new URL(request.url);
  // /api/public/jobs/... → /jobs/... (zachowuje query, np. ?token=...)
  return url.pathname.slice(PUBLIC_PREFIX.length - 1) + url.search;
}

async function forwardToWorker(request: Request, pathWithQuery: string): Promise<Response> {
  const token = process.env["WORKER_TOKEN"] ?? "";
  if (!token) {
    console.error("[gateway] WORKER_TOKEN is not set — refusing to proxy.");
    return Response.json({ error: "WORKER_NOT_CONFIGURED" }, { status: 503 });
  }

  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit = { method: request.method, headers };
  if (hasBody) {
    const raw = await request.text();
    if (raw.length > 64 * 1024) {
      return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    }
    init.body = raw;
  }

  try {
    return await fetch(`${workerBaseUrl()}${pathWithQuery}`, init);
  } catch (error) {
    console.error("[gateway] worker unreachable:", error);
    return Response.json({ error: "WORKER_UNAVAILABLE" }, { status: 502 });
  }
}

/**
 * Obsługuje endpointy gatewayu. Zwraca `null`, gdy żądanie nie należy
 * do gatewayu (wtedy obsługuje je właściwy handler aplikacji).
 */
export async function handleDownloaderApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/health") {
    return Response.json({ ok: true });
  }

  if (!pathname.startsWith(PUBLIC_PREFIX)) return null;

  if (getSessionUser(request) === null) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  return forwardToWorker(request, workerPath(request));
}
