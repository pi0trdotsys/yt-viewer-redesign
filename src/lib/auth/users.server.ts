import { sha256Hex, timingSafeEqualHex } from "./crypto.server";
import type { PublicUser } from "./types.shared";

/**
 * Trzej użytkownicy aplikacji, konfigurowani przez env (analogicznie do
 * poprzedniego `AUTH_USER`/`AUTH_PASSWORD_SHA256`, tylko x3):
 *   AUTH_USER_n            — login (widoczny jako nazwa kafelka, jeśli brak AUTH_NAME_n)
 *   AUTH_PASSWORD_SHA256_n — sha256 (lowercase hex) hasła
 *   AUTH_NAME_n            — opcjonalna nazwa wyświetlana
 *
 * Env czytany wyłącznie wewnątrz funkcji (kontrakt §2) — nigdy w module scope.
 */

interface ConfiguredUser {
  id: string;
  name: string;
  passwordSha256: string;
}

const SLOTS = [1, 2, 3] as const;

function loadUsers(): ConfiguredUser[] {
  const users: ConfiguredUser[] = [];
  for (const slot of SLOTS) {
    const id = process.env[`AUTH_USER_${slot}`];
    const passwordSha256 = (process.env[`AUTH_PASSWORD_SHA256_${slot}`] ?? "").trim().toLowerCase();
    if (!id || !passwordSha256) continue;
    const name = process.env[`AUTH_NAME_${slot}`]?.trim() || id;
    users.push({ id, name, passwordSha256 });
  }
  return users;
}

/** Czy skonfigurowano przynajmniej jednego użytkownika. */
export function authConfigured(): boolean {
  return loadUsers().length > 0;
}

/** Lista userów bez haseł — bezpieczna do wysłania klientowi (profile picker). */
export function getPublicUsers(): PublicUser[] {
  return loadUsers().map(({ id, name }) => ({ id, name }));
}

export function findPublicUser(userId: string): PublicUser | null {
  const user = loadUsers().find((u) => u.id === userId);
  return user ? { id: user.id, name: user.name } : null;
}

export async function verifyCredentials(userId: string, password: string): Promise<boolean> {
  const user = loadUsers().find((u) => u.id === userId);
  if (!user) return false;
  const passwordHash = await sha256Hex(password);
  return timingSafeEqualHex(passwordHash, user.passwordSha256);
}
