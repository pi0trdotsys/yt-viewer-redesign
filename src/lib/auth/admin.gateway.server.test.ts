import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), "admin-gateway-test-"));
  process.env["USERS_FILE"] = join(dir, "users.json");
  process.env["SESSION_SECRET"] = "test-secret";
  process.env["AUTH_USER_1"] = "alice";
  process.env["AUTH_PASSWORD_SHA256_1"] =
    "0000000000000000000000000000000000000000000000000000000000000000".slice(0, 64);
  process.env["AUTH_NAME_1"] = "Alice";
  process.env["AUTH_USER_2"] = "bob";
  process.env["AUTH_PASSWORD_SHA256_2"] =
    "1111111111111111111111111111111111111111111111111111111111111111".slice(0, 64);
  process.env["AUTH_NAME_2"] = "Bob";
});

afterEach(async () => {
  for (const key of [
    "USERS_FILE",
    "SESSION_SECRET",
    "AUTH_USER_1",
    "AUTH_PASSWORD_SHA256_1",
    "AUTH_NAME_1",
    "AUTH_USER_2",
    "AUTH_PASSWORD_SHA256_2",
    "AUTH_NAME_2",
  ]) {
    delete process.env[key];
  }
  await rm(dir, { recursive: true, force: true });
});

async function cookieFor(userId: string): Promise<string> {
  const { createSessionCookieHeader } = await import("./session.server");
  return createSessionCookieHeader(userId).split(";")[0]!;
}

describe("handleAdminApi — autoryzacja", () => {
  it("zwraca null dla żądań spoza /api/admin/*", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    expect(await handleAdminApi(new Request("http://localhost/api/auth/session"))).toBeNull();
  });

  it("bez sesji → 401", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const res = await handleAdminApi(new Request("http://localhost/api/admin/users"));
    expect(res?.status).toBe(401);
  });

  it("sesja bez roli admina → 403", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("bob"); // bob = zwykły user (alice jest bootstrap-adminem)
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users", { headers: { cookie } }),
    );
    expect(res?.status).toBe(403);
  });
});

describe("handleAdminApi — CRUD jako admin", () => {
  it("GET /api/admin/users listuje konta z rolami", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users", { headers: { cookie } }),
    );
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { users: { id: string; role: string }[] };
    expect(data.users.find((u) => u.id === "alice")?.role).toBe("admin");
  });

  it("POST /api/admin/users tworzy konto", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ id: "dorota", name: "Dorota", password: "secret123" }),
      }),
    );
    expect(res?.status).toBe(201);
  });

  it("POST z nieprawidłowym id (wielkie litery) → 400", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ id: "Dorota", name: "Dorota", password: "secret123" }),
      }),
    );
    expect(res?.status).toBe(400);
  });

  it("POST z za krótkim hasłem → 400", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ id: "dorota", name: "Dorota", password: "short" }),
      }),
    );
    expect(res?.status).toBe(400);
  });

  it("PATCH zmienia nazwę konta", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/bob", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ name: "Bobby" }),
      }),
    );
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { user: { name: string } };
    expect(data.user.name).toBe("Bobby");
  });

  it("PATCH próbujący odebrać rolę jedynemu adminowi → 409", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/alice", {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ role: "user" }),
      }),
    );
    expect(res?.status).toBe(409);
  });

  it("PUT .../password ustawia nowe hasło innemu kontu", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const { verifyCredentials } = await import("./users.store.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/bob/password", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ password: "brand-new-pass" }),
      }),
    );
    expect(res?.status).toBe(200);
    await expect(verifyCredentials("bob", "brand-new-pass")).resolves.toBe(true);
  });

  it("DELETE własnego konta odrzucone", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/alice", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(res?.status).toBe(400);
  });

  it("DELETE innego (nie-admina) konta działa", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/bob", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(res?.status).toBe(200);
  });

  it("DELETE nieistniejącego konta → 404", async () => {
    const { handleAdminApi } = await import("./admin.gateway.server");
    const cookie = await cookieFor("alice");
    const res = await handleAdminApi(
      new Request("http://localhost/api/admin/users/ghost", {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(res?.status).toBe(404);
  });
});
