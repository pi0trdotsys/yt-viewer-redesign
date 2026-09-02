import { sha256Hex, timingSafeEqualHex } from "./crypto.server";
import { USER_ACCENTS, type PublicUser, type UserAccent } from "./types.shared";

/**
 * Trzej użytkownicy aplikacji, konfigurowani przez env (analogicznie do
 * poprzedniego `AUTH_USER`/`AUTH_PASSWORD_SHA256`, tylko x3):
 *   AUTH_USER_n            — login (widoczny jako nazwa kafelka, jeśli brak AUTH_NAME_n)
 *   AUTH_PASSWORD_SHA256_n — sha256 (lowercase hex) hasła
 *   AUTH_NAME_n            — opcjonalna nazwa wyświetlana
 *   AUTH_AVATAR_n           — opcjonalny emoji zamiast inicjałów na kafelku
 *   AUTH_ACCENT_n           — opcjonalny wariant koloru: "primary" | "navy"
 *
 * Env czytany wyłącznie wewnątrz funkcji (kontrakt §2) — nigdy w module scope.
 */

interface ConfiguredUser {
  id: string;
  name: string;
  passwordSha256: string;
  avatar?: string | undefined;
  accent: UserAccent;
}

const SLOTS = [1, 2, 3] as const;

function parseAccent(raw: string | undefined): UserAccent {
  const value = raw?.trim().toLowerCase();
  return (USER_ACCENTS as readonly string[]).includes(value ?? "")
    ? (value as UserAccent)
    : "primary";
}

function loadUsers(): ConfiguredUser[] {
  const users: ConfiguredUser[] = [];
  for (const slot of SLOTS) {
    const id = process.env[`AUTH_USER_${slot}`];
    const passwordSha256 = (process.env[`AUTH_PASSWORD_SHA256_${slot}`] ?? "").trim().toLowerCase();
    if (!id || !passwordSha256) continue;
    const name = process.env[`AUTH_NAME_${slot}`]?.trim() || id;
    const avatar = process.env[`AUTH_AVATAR_${slot}`]?.trim() || undefined;
    const accent = parseAccent(process.env[`AUTH_ACCENT_${slot}`]);
    users.push({ id, name, passwordSha256, avatar, accent });
  }
  return users;
}

/** Czy skonfigurowano przynajmniej jednego użytkownika. */
export function authConfigured(): boolean {
  return loadUsers().length > 0;
}

function toPublic(user: ConfiguredUser): PublicUser {
  return { id: user.id, name: user.name, avatar: user.avatar, accent: user.accent };
}

/** Lista userów bez haseł — bezpieczna do wysłania klientowi (profile picker). */
export function getPublicUsers(): PublicUser[] {
  return loadUsers().map(toPublic);
}

export function findPublicUser(userId: string): PublicUser | null {
  const user = loadUsers().find((u) => u.id === userId);
  return user ? toPublic(user) : null;
}

export async function verifyCredentials(userId: string, password: string): Promise<boolean> {
  const user = loadUsers().find((u) => u.id === userId);
  if (!user) return false;
  const passwordHash = await sha256Hex(password);
  return timingSafeEqualHex(passwordHash, user.passwordSha256);
}
