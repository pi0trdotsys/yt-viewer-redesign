import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleDownloaderApi } from "./lib/downloader/gateway.server";

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

// ---------------------------------------------------------------------------
// Basic Auth gate
//
// Covers every request reaching the server (SSR pages, server functions, SSE,
// static assets, file downloads). Credentials come from env:
//   AUTH_USER             — login
//   AUTH_PASSWORD_SHA256  — lowercase hex sha256 of the password
// Fail-closed in production: if either variable is missing, every request is
// denied. In development (NODE_ENV !== "production") an unconfigured auth
// stays open so `vite dev` works out of the box.
// ---------------------------------------------------------------------------

const HEALTH_PATH = "/api/health";

function basicAuthConfigured(): boolean {
  return Boolean(process.env["AUTH_USER"] && process.env["AUTH_PASSWORD_SHA256"]);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Constant-time comparison of equal-length strings (hex digests). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function unauthorizedResponse(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="YT Viewer", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function isAuthorized(request: Request): Promise<boolean> {
  const expectedUser = process.env["AUTH_USER"] ?? "";
  const expectedPasswordHash = (process.env["AUTH_PASSWORD_SHA256"] ?? "").trim().toLowerCase();

  const header = request.headers.get("authorization") ?? "";
  const match = /^Basic\s+(.+)$/i.exec(header);
  if (!match) return false;

  let decoded: string;
  try {
    decoded = atob(match[1]!.trim());
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  // Hash both sides so every comparison is over fixed-length digests.
  const [userHash, expectedUserHash, passwordHash] = await Promise.all([
    sha256Hex(user),
    sha256Hex(expectedUser),
    sha256Hex(password),
  ]);

  return (
    timingSafeEqualHex(userHash, expectedUserHash) &&
    timingSafeEqualHex(passwordHash, expectedPasswordHash)
  );
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

      // Basic Auth gate.
      if (basicAuthConfigured()) {
        if (!(await isAuthorized(request))) {
          return unauthorizedResponse();
        }
      } else if (process.env["NODE_ENV"] === "production") {
        console.error(
          "Basic Auth is not configured (set AUTH_USER and AUTH_PASSWORD_SHA256) — denying request.",
        );
        return unauthorizedResponse();
      }

      // Downloader gateway: /api/public/* proxied to the yt-dlp worker.
      const apiResponse = await handleDownloaderApi(request);
      if (apiResponse) return apiResponse;

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
