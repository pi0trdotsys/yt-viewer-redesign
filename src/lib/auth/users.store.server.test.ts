import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * `users.store.server.ts` trzyma cały plik w module-scope cache (patrz
 * komentarz w źródle) — każdy test dostaje świeży moduł (`vi.resetModules`)
 * i własny `USERS_FILE` w katalogu tymczasowym, żeby testy się nie
 * przenikały i nie dotykały prawdziwego pliku kont dev/produkcji.
 */

let dir: string;

async function freshStore() {
  const { vi } = await import("vitest");
  vi.resetModules();
  return import("./users.store.server");
}

function setBootstrapEnv(): void {
  process.env["AUTH_USER_1"] = "alice";
  process.env["AUTH_PASSWORD_SHA256_1"] =
    "0000000000000000000000000000000000000000000000000000000000000000".slice(0, 64);
  process.env["AUTH_NAME_1"] = "Alice";
  process.env["AUTH_USER_2"] = "bob";
  process.env["AUTH_PASSWORD_SHA256_2"] =
    "1111111111111111111111111111111111111111111111111111111111111111".slice(0, 64);
  process.env["AUTH_NAME_2"] = "Bob";
}

function clearBootstrapEnv(): void {
  for (const key of [
    "AUTH_USER_1",
    "AUTH_PASSWORD_SHA256_1",
    "AUTH_NAME_1",
    "AUTH_USER_2",
    "AUTH_PASSWORD_SHA256_2",
    "AUTH_NAME_2",
    "AUTH_USER_3",
    "AUTH_PASSWORD_SHA256_3",
    "ADMIN_USER",
  ]) {
    delete process.env[key];
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "users-store-test-"));
  process.env["USERS_FILE"] = join(dir, "users.json");
  clearBootstrapEnv();
});

afterEach(async () => {
  delete process.env["USERS_FILE"];
  clearBootstrapEnv();
  await rm(dir, { recursive: true, force: true });
});

describe("bootstrap", () => {
  it("brak env → pusty magazyn, authConfigured=false", async () => {
    const store = await freshStore();
    expect(await store.authConfigured()).toBe(false);
    expect(await store.getPublicUsers()).toEqual([]);
  });

  it("buduje konta z AUTH_USER_n, rola admina domyślnie na slot 1", async () => {
    setBootstrapEnv();
    const store = await freshStore();
    const users = await store.getPublicUsers();
    expect(users.map((u) => u.id).sort()).toEqual(["alice", "bob"]);

    const alice = await store.findSessionUser("alice");
    expect(alice?.role).toBe("admin");
    const bob = await store.findSessionUser("bob");
    expect(bob?.role).toBe("user");
  });

  it("ADMIN_USER wskazuje inne konto niż slot 1", async () => {
    setBootstrapEnv();
    process.env["ADMIN_USER"] = "bob";
    const store = await freshStore();
    expect((await store.findSessionUser("bob"))?.role).toBe("admin");
    expect((await store.findSessionUser("alice"))?.role).toBe("user");
  });

  it("zapisuje bootstrap na dysk — kolejne wczytanie widzi ten sam stan", async () => {
    setBootstrapEnv();
    const store1 = await freshStore();
    await store1.getPublicUsers(); // wymusza load()+zapis

    const raw = await readFile(process.env["USERS_FILE"]!, "utf8");
    const parsed = JSON.parse(raw) as { users: unknown[] };
    expect(parsed.users).toHaveLength(2);

    // Drugi "proces" (świeży moduł) wczytuje z dysku, env już wyczyszczone —
    // gdyby czytał env zamiast pliku, dostałby pusty magazyn.
    clearBootstrapEnv();
    const store2 = await freshStore();
    expect(await store2.getPublicUsers()).toHaveLength(2);
  });
});

describe("verifyCredentials + rehash-on-login", () => {
  it("weryfikuje hasło zbootstrapowane z env (legacy sha256)", async () => {
    const { sha256Hex } = await import("./crypto.server");
    setBootstrapEnv();
    // Ustawiamy hash jawnie na sha256("known-password"), żeby zweryfikować
    // konkretnym, znanym hasłem zamiast zgadywać co pasuje do stałej "0000…".
    process.env["AUTH_PASSWORD_SHA256_1"] = await sha256Hex("known-password");

    const store = await freshStore();
    await expect(store.verifyCredentials("alice", "known-password")).resolves.toBe(true);
    await expect(store.verifyCredentials("alice", "wrong")).resolves.toBe(false);
  });

  it("przepisuje hasło na pbkdf2 po pierwszym udanym logowaniu", async () => {
    const { sha256Hex } = await import("./crypto.server");
    setBootstrapEnv();
    process.env["AUTH_PASSWORD_SHA256_1"] = await sha256Hex("known-password");
    const store = await freshStore();

    await store.verifyCredentials("alice", "known-password");

    const raw = await readFile(process.env["USERS_FILE"]!, "utf8");
    const parsed = JSON.parse(raw) as { users: { id: string; password: { algo: string } }[] };
    const alice = parsed.users.find((u) => u.id === "alice");
    expect(alice?.password.algo).toBe("pbkdf2");

    // Nowe hasło nadal działa po rehashu.
    await expect(store.verifyCredentials("alice", "known-password")).resolves.toBe(true);
  });

  it("nieistniejące konto → false", async () => {
    const store = await freshStore();
    await expect(store.verifyCredentials("ghost", "whatever")).resolves.toBe(false);
  });
});

describe("panel admina: CRUD i ochrona ostatniego admina", () => {
  it("createAccount tworzy konto z domyślną rolą user", async () => {
    const store = await freshStore();
    const created = await store.createAccount({
      id: "dorota",
      name: "Dorota",
      password: "x".repeat(8),
    });
    expect(created.role).toBe("user");
    expect(created.id).toBe("dorota");
  });

  it("createAccount odrzuca duplikat id", async () => {
    const store = await freshStore();
    await store.createAccount({ id: "dorota", name: "Dorota", password: "x".repeat(8) });
    await expect(
      store.createAccount({ id: "dorota", name: "Inna", password: "y".repeat(8) }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("nowo utworzone konto może się od razu zalogować", async () => {
    const store = await freshStore();
    await store.createAccount({ id: "dorota", name: "Dorota", password: "secret123" });
    await expect(store.verifyCredentials("dorota", "secret123")).resolves.toBe(true);
  });

  it("nie da się odebrać roli jedynemu adminowi", async () => {
    setBootstrapEnv(); // alice = admin (jedyny)
    const store = await freshStore();
    await expect(store.updateAccount("alice", { role: "user" })).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it("nie da się usunąć jedynego admina", async () => {
    setBootstrapEnv();
    const store = await freshStore();
    await expect(store.deleteAccount("alice")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("po dodaniu drugiego admina można zdegradować/usunąć pierwszego", async () => {
    setBootstrapEnv();
    const store = await freshStore();
    await store.updateAccount("bob", { role: "admin" });
    await expect(store.updateAccount("alice", { role: "user" })).resolves.toMatchObject({
      role: "user",
    });
  });

  it("updateAccount na nieistniejące konto rzuca 404", async () => {
    const store = await freshStore();
    await expect(store.updateAccount("ghost", { name: "x" })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("setAccountPassword pozwala zalogować się nowym hasłem", async () => {
    const store = await freshStore();
    await store.createAccount({ id: "dorota", name: "Dorota", password: "old-password" });
    await store.setAccountPassword("dorota", "new-password");
    await expect(store.verifyCredentials("dorota", "old-password")).resolves.toBe(false);
    await expect(store.verifyCredentials("dorota", "new-password")).resolves.toBe(true);
  });

  it("changeOwnPassword weryfikuje aktualne hasło przed zmianą", async () => {
    const store = await freshStore();
    await store.createAccount({ id: "dorota", name: "Dorota", password: "old-password" });
    await expect(
      store.changeOwnPassword("dorota", "zle-haslo", "new-password"),
    ).rejects.toMatchObject({ statusCode: 401 });
    await store.changeOwnPassword("dorota", "old-password", "new-password");
    await expect(store.verifyCredentials("dorota", "new-password")).resolves.toBe(true);
  });

  it("deleteAccount usuwa zwykłe (nie-admin) konto bez ograniczeń", async () => {
    const store = await freshStore();
    await store.createAccount({ id: "dorota", name: "Dorota", password: "x".repeat(8) });
    await store.deleteAccount("dorota");
    expect(await store.getPublicUsers()).toEqual([]);
  });
});
