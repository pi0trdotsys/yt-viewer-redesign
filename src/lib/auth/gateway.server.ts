import { isRateLimited, recordFailedAttempt, clearAttempts } from "./rate-limit.server";
import {
  clearSessionCookieHeader,
  createSessionCookieHeader,
  getSessionUser,
} from "./session.server";
import { getPublicUsers, verifyCredentials } from "./users.server";
import { loginInputSchema } from "./types.shared";

/**
 * `/api/auth/*` — logowanie/wylogowanie/stan sesji. Wzorowane na
 * `src/lib/downloader/gateway.server.ts`: czysta funkcja `Request → Response
 * | null`, wołana identycznie z `src/server.ts` (produkcja) i
 * `plugins/downloader-gateway-dev.ts` (dev), żeby zachowanie było spójne
 * w obu trybach.
 */

const PREFIX = "/api/auth/";

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (extraHeaders) new Headers(extraHeaders).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(data), { status, headers });
}

async function handleSession(request: Request): Promise<Response> {
  const user = getSessionUser(request);
  return json({ authenticated: user !== null, user, users: getPublicUsers() });
}

async function handleLogin(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Nieprawidłowe żądanie" }, 400);
  }

  const parsed = loginInputSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Nieprawidłowe żądanie" }, 400);
  }
  const { userId, password } = parsed.data;

  if (isRateLimited(userId)) {
    return json({ error: "Zbyt wiele prób — spróbuj za kilka minut" }, 429);
  }

  const ok = await verifyCredentials(userId, password);
  if (!ok) {
    recordFailedAttempt(userId);
    return json({ error: "Nieprawidłowy login lub hasło" }, 401);
  }

  clearAttempts(userId);
  const users = getPublicUsers();
  const user = users.find((u) => u.id === userId) ?? null;
  return json({ ok: true, user }, 200, { "set-cookie": createSessionCookieHeader(userId) });
}

function handleLogout(): Response {
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookieHeader() });
}

export async function handleAuthApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(PREFIX)) return null;

  if (pathname === "/api/auth/session" && request.method === "GET") {
    return handleSession(request);
  }
  if (pathname === "/api/auth/login" && request.method === "POST") {
    return handleLogin(request);
  }
  if (pathname === "/api/auth/logout" && request.method === "POST") {
    return handleLogout();
  }
  return json({ error: "Not found" }, 404);
}
