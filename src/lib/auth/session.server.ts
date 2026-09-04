import { hmacHex, timingSafeEqualHex } from "./crypto.server";
import { findSessionUser } from "./users.store.server";
import type { SessionUser } from "./types.shared";

/**
 * Sesja logowania: podpisane HMAC ciasteczko (ten sam wzorzec co
 * `jobStreamToken` w `worker/src/tokens.ts`, rozszerzony o expiry).
 * Bezstanowe — nic po stronie serwera, więc restart appki nie wylogowuje.
 */

export const SESSION_COOKIE_NAME = "ytdl_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 dni

function sessionSecret(): string {
  return process.env["SESSION_SECRET"] ?? "";
}

function encodeUserId(userId: string): string {
  return Buffer.from(userId, "utf8").toString("base64url");
}

function decodeUserId(encoded: string): string | null {
  try {
    return Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function sign(payload: string, secret: string): string {
  return hmacHex(payload, secret);
}

/** Wartość ciasteczka: `${base64url(userId)}.${expiresAtMs}.${hmac}`. */
function buildCookieValue(userId: string, secret: string): string {
  const expiresAtMs = Date.now() + SESSION_MAX_AGE_SEC * 1000;
  const payload = `${encodeUserId(userId)}.${expiresAtMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function cookieAttributes(): string {
  const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

/** `Set-Cookie` nagłówek logujący `userId` (30 dni). */
export function createSessionCookieHeader(userId: string): string {
  const secret = sessionSecret();
  const value = buildCookieValue(userId, secret);
  return `${SESSION_COOKIE_NAME}=${value}; ${cookieAttributes()}; Max-Age=${SESSION_MAX_AGE_SEC}`;
}

/** `Set-Cookie` nagłówek czyszczący sesję (wylogowanie). */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttributes()}; Max-Age=0`;
}

/**
 * Weryfikuje ciasteczko sesji z żądania: podpis HMAC w czasie stałym,
 * termin ważności, oraz że user nadal istnieje w konfiguracji env (na
 * wypadek gdyby admin usunął/zmienił konto po wydaniu ciasteczka).
 */
export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const secret = sessionSecret();
  if (!secret) return null;

  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return null;

  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [encodedUserId, expiresAtRaw, signature] = parts as [string, string, string];

  const payload = `${encodedUserId}.${expiresAtRaw}`;
  const expected = sign(payload, secret);
  if (!timingSafeEqualHex(expected, signature)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const userId = decodeUserId(encodedUserId);
  if (!userId) return null;

  return findSessionUser(userId);
}
