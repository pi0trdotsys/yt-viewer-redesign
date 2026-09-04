import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { hashPassword, needsRehash, verifyPassword, type PasswordRecord } from "./password.server";
import { httpError, type HttpError } from "./http-error";
import {
  USER_ACCENTS,
  type AccountRole,
  type AdminUserDto,
  type CreateAccountInput,
  type PublicUser,
  type SessionUser,
  type UpdateAccountInput,
  type UserAccent,
} from "./types.shared";

/**
 * Magazyn kont — plik JSON na wolumenie (`USERS_FILE`), zamiast konfiguracji
 * przez `.env` (zmiana hasła = SSH + restart). Zapis atomowy (temp + rename).
 *
 * Cache: cały plik trzymany w pamięci procesu po pierwszym odczycie/
 * bootstrapie i aktualizowany przy KAŻDEJ mutacji — bez odczytu z dysku przy
 * każdym żądaniu. Świadome uproszczenie względem "cache invalidowany po
 * mtime" z planu: appka działa jako pojedynczy proces (self-hosted, jeden
 * kontener) i jest jedynym zapisującym do tego pliku, więc mtime-watching
 * dodawałby złożoność bez realnej korzyści.
 *
 * Bootstrap: brak pliku → jednorazowo zbudowany z `AUTH_USER_1..3` (+
 * `AUTH_NAME/AVATAR/ACCENT_n`), z hasłami w starym formacie sha256 (rehash na
 * PBKDF2 przy pierwszym udanym logowaniu, patrz `password.server.ts`). Rola
 * admina: konto wskazane przez `ADMIN_USER`, domyślnie slot 1.
 */

export interface StoredUser {
  id: string;
  name: string;
  avatar?: string | undefined;
  accent: UserAccent;
  role: AccountRole;
  password: PasswordRecord;
  createdAt: number;
  updatedAt: number;
}

interface StoreFile {
  version: 1;
  users: StoredUser[];
}

const SLOTS = [1, 2, 3] as const;

function usersFilePath(): string {
  const configured = process.env["USERS_FILE"];
  if (configured) return configured;
  return process.env["NODE_ENV"] === "production"
    ? "/data/users.json"
    : join(process.cwd(), ".data", "users.json");
}

function parseAccent(raw: string | undefined): UserAccent {
  const value = raw?.trim().toLowerCase();
  return (USER_ACCENTS as readonly string[]).includes(value ?? "")
    ? (value as UserAccent)
    : "primary";
}

function bootstrapFromEnv(): StoredUser[] {
  const adminUser = process.env["ADMIN_USER"]?.trim();
  const users: StoredUser[] = [];
  for (const slot of SLOTS) {
    const id = process.env[`AUTH_USER_${slot}`]?.trim();
    const passwordSha256 = (process.env[`AUTH_PASSWORD_SHA256_${slot}`] ?? "").trim().toLowerCase();
    if (!id || !passwordSha256) continue;
    const name = process.env[`AUTH_NAME_${slot}`]?.trim() || id;
    const avatar = process.env[`AUTH_AVATAR_${slot}`]?.trim() || undefined;
    const accent = parseAccent(process.env[`AUTH_ACCENT_${slot}`]);
    const now = Date.now();
    users.push({
      id,
      name,
      avatar,
      accent,
      role: "user",
      password: { algo: "sha256", hash: passwordSha256 },
      createdAt: now,
      updatedAt: now,
    });
  }
  if (users.length > 0) {
    const admin = (adminUser && users.find((u) => u.id === adminUser)) || users[0];
    if (admin) admin.role = "admin";
  }
  return users;
}

let cache: StoreFile | undefined;
let loadingPromise: Promise<StoreFile> | undefined;

async function readStoreFile(): Promise<StoreFile | null> {
  try {
    const raw = await readFile(usersFilePath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as StoreFile).users) &&
      (parsed as StoreFile).version === 1
    ) {
      return parsed as StoreFile;
    }
    console.error(
      "[users.store] Nieprawidłowy format pliku kont — ignoruję i bootstrapuję na nowo.",
    );
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[users.store] Nie udało się odczytać pliku kont:", error);
    }
    return null;
  }
}

async function writeStoreFile(store: StoreFile): Promise<void> {
  const path = usersFilePath();
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmpPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tmpPath, path);
}

async function load(): Promise<StoreFile> {
  if (cache) return cache;
  if (!loadingPromise) {
    loadingPromise = (async () => {
      const existing = await readStoreFile();
      if (existing) {
        cache = existing;
        return existing;
      }
      const bootstrapped: StoreFile = { version: 1, users: bootstrapFromEnv() };
      if (bootstrapped.users.length > 0) {
        await writeStoreFile(bootstrapped).catch((error) => {
          // Zapis może się nie udać (np. brak wolumenu w dev bez uprawnień)
          // — appka i tak działa dalej w pamięci na czas życia procesu.
          console.error("[users.store] Nie udało się zapisać bootstrapu na dysk:", error);
        });
      }
      cache = bootstrapped;
      return bootstrapped;
    })();
  }
  try {
    return await loadingPromise;
  } finally {
    loadingPromise = undefined;
  }
}

async function persist(): Promise<void> {
  if (!cache) return;
  await writeStoreFile(cache);
}

function toPublic(user: StoredUser): PublicUser {
  return { id: user.id, name: user.name, avatar: user.avatar, accent: user.accent };
}

function toSessionUser(user: StoredUser): SessionUser {
  return { ...toPublic(user), role: user.role };
}

function toAdminDto(user: StoredUser): AdminUserDto {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    accent: user.accent,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// --- API zgodne z dawnym users.server.ts (żeby login.tsx/session.server.ts
// /guard.server.ts nie musiały się zmieniać) ---------------------------------

export async function authConfigured(): Promise<boolean> {
  const store = await load();
  return store.users.length > 0;
}

export async function getPublicUsers(): Promise<PublicUser[]> {
  const store = await load();
  return store.users.map(toPublic);
}

export async function findSessionUser(userId: string): Promise<SessionUser | null> {
  const store = await load();
  const user = store.users.find((u) => u.id === userId);
  return user ? toSessionUser(user) : null;
}

/** Weryfikuje hasło i — jeśli trafi na stary format sha256 — przepisuje je
 *  od razu na PBKDF2 (rehash-on-login, bez przerwy w działaniu). */
export async function verifyCredentials(userId: string, password: string): Promise<boolean> {
  const store = await load();
  const user = store.users.find((u) => u.id === userId);
  if (!user) return false;
  const ok = await verifyPassword(password, user.password);
  if (!ok) return false;
  if (needsRehash(user.password)) {
    user.password = hashPassword(password);
    user.updatedAt = Date.now();
    await persist().catch((error) => console.error("[users.store] Rehash zapis nieudany:", error));
  }
  return true;
}

// --- panel admina ------------------------------------------------------------

export async function listAdminUsers(): Promise<AdminUserDto[]> {
  const store = await load();
  return store.users.map(toAdminDto);
}

export async function countAdmins(store?: StoreFile): Promise<number> {
  const s = store ?? (await load());
  return s.users.filter((u) => u.role === "admin").length;
}

export async function createAccount(input: CreateAccountInput): Promise<AdminUserDto> {
  const store = await load();
  if (store.users.some((u) => u.id === input.id)) {
    throw httpError(409, "Konto o tym loginie już istnieje");
  }
  const now = Date.now();
  const user: StoredUser = {
    id: input.id,
    name: input.name,
    avatar: input.avatar || undefined,
    accent: input.accent ?? "primary",
    role: input.role ?? "user",
    password: hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };
  store.users.push(user);
  await persist();
  return toAdminDto(user);
}

export async function updateAccount(id: string, patch: UpdateAccountInput): Promise<AdminUserDto> {
  const store = await load();
  const user = store.users.find((u) => u.id === id);
  if (!user) throw httpError(404, "Nie znaleziono konta");

  if (patch.role && patch.role !== user.role && user.role === "admin" && patch.role !== "admin") {
    if ((await countAdmins(store)) <= 1) {
      throw httpError(409, "Nie można odebrać roli admina ostatniemu adminowi");
    }
  }

  if (patch.name !== undefined) user.name = patch.name;
  if (patch.avatar !== undefined) user.avatar = patch.avatar || undefined;
  if (patch.accent !== undefined) user.accent = patch.accent;
  if (patch.role !== undefined) user.role = patch.role;
  user.updatedAt = Date.now();

  await persist();
  return toAdminDto(user);
}

export async function deleteAccount(id: string): Promise<void> {
  const store = await load();
  const user = store.users.find((u) => u.id === id);
  if (!user) throw httpError(404, "Nie znaleziono konta");
  if (user.role === "admin" && (await countAdmins(store)) <= 1) {
    throw httpError(409, "Nie można usunąć ostatniego konta admina");
  }
  store.users = store.users.filter((u) => u.id !== id);
  await persist();
}

export async function setAccountPassword(id: string, password: string): Promise<void> {
  const store = await load();
  const user = store.users.find((u) => u.id === id);
  if (!user) throw httpError(404, "Nie znaleziono konta");
  user.password = hashPassword(password);
  user.updatedAt = Date.now();
  await persist();
}

/** Samoobsługowa zmiana własnego hasła — weryfikuje aktualne przed zapisem. */
export async function changeOwnPassword(
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const store = await load();
  const user = store.users.find((u) => u.id === id);
  if (!user) throw httpError(404, "Nie znaleziono konta");
  const ok = await verifyPassword(currentPassword, user.password);
  if (!ok) throw httpError(401, "Aktualne hasło jest nieprawidłowe");
  user.password = hashPassword(newPassword);
  user.updatedAt = Date.now();
  await persist();
}

export type { HttpError };
