import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

import { sha256Hex, timingSafeEqualHex } from "./crypto.server";

/**
 * Hasła kont: PBKDF2-SHA256 (`node:crypto`, bez nowych zależności) dla
 * wszystkiego zapisanego przez panel admina. Konta zbootstrapowane ze
 * starych `AUTH_PASSWORD_SHA256_n` (patrz `users.store.server.ts`) dostają
 * `algo: "sha256"` i są przepisywane na PBKDF2 przy pierwszym poprawnym
 * logowaniu (`needsRehash` + wywołujący ustawia nowy rekord) — zero przerwy
 * w działaniu istniejących haseł.
 */

const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

export interface Pbkdf2PasswordRecord {
  algo: "pbkdf2";
  salt: string;
  iterations: number;
  hash: string;
}

/** Wyłącznie efekt bootstrapu ze starego `.env` — nigdy nie zapisywane dla
 *  nowych/edytowanych kont (patrz `hashPassword`). */
export interface LegacySha256PasswordRecord {
  algo: "sha256";
  hash: string;
}

export type PasswordRecord = Pbkdf2PasswordRecord | LegacySha256PasswordRecord;

export function hashPassword(password: string): Pbkdf2PasswordRecord {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST).toString(
    "hex",
  );
  return { algo: "pbkdf2", salt, iterations: PBKDF2_ITERATIONS, hash };
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  if (record.algo === "pbkdf2") {
    const candidate = pbkdf2Sync(
      password,
      record.salt,
      record.iterations,
      PBKDF2_KEYLEN,
      PBKDF2_DIGEST,
    );
    const expected = Buffer.from(record.hash, "hex");
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
  // Legacy: sha256Hex zwraca hex tej samej długości co wcześniejszy
  // AUTH_PASSWORD_SHA256_n — porównanie w czasie stałym jak dawniej.
  const candidateHex = await sha256Hex(password);
  return timingSafeEqualHex(candidateHex, record.hash);
}

/** Czy rekord powinien zostać przepisany na PBKDF2 po udanym logowaniu. */
export function needsRehash(record: PasswordRecord): boolean {
  return record.algo !== "pbkdf2";
}
