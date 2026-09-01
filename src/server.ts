import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleDownloaderApi } from "./lib/downloader/gateway.server";
import { handleAuthApi } from "./lib/auth/gateway.server";
import { guardPageRequest } from "./lib/auth/guard.server";
import { authConfigured } from "./lib/auth/users.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const { pathname } = new URL(request.url);

      // Health check — unauthenticated, used by tunnel/monitoring.
      if (pathname === "/api/health") {
        return Response.json({ ok: true });
      }

      // Fail-closed in production if nobody configured the three accounts
      // (AUTH_USER_1..3 / AUTH_PASSWORD_SHA256_1..3). In development an
      // unconfigured auth stays open so `vite dev` works out of the box.
      if (process.env["NODE_ENV"] === "production" && !authConfigured()) {
        console.error(
          "Brak skonfigurowanych użytkowników (AUTH_USER_1..3 / AUTH_PASSWORD_SHA256_1..3) — odmawiam żądań.",
        );
        return Response.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
      }

      // Logowanie/wylogowanie/stan sesji — zawsze publiczne.
      const authResponse = await handleAuthApi(request);
      if (authResponse) return authResponse;

      // Downloader gateway: /api/public/* proxied to the yt-dlp worker
      // (chronione sesją logowania wewnątrz handleDownloaderApi).
      const apiResponse = await handleDownloaderApi(request);
      if (apiResponse) return apiResponse;

      // Ochrona stron: `/` wymaga sesji, `/login` odsyła zalogowanych na `/`.
      const guardResponse = guardPageRequest(request);
      if (guardResponse) return guardResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
