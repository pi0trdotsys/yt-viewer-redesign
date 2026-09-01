import { createHmac } from "node:crypto";

/**
 * Prymitywy kryptograficzne używane przez warstwę auth. Wydzielone tu, bo
 * te same helpery były wcześniej lokalne w `server.ts` (Basic Auth) — teraz
 * służą też sesji cookie i weryfikacji haseł trzech użytkowników.
 */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export function hmacHex(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

/** Porównanie w czasie stałym dwóch ciągów o tej samej (oczekiwanej) długości. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
