import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), "auth-gateway-test-"));
  process.env["USERS_FILE"] = join(dir, "users.json");
  process.env["SESSION_SECRET"] = "test-secret";
  const { sha256Hex } = await import("./crypto.server");
  process.env["AUTH_USER_1"] = "alice";
  process.env["AUTH_PASSWORD_SHA256_1"] = await sha256Hex("correct-password");
  process.env["AUTH_NAME_1"] = "Alice";
});

afterEach(async () => {
  delete process.env["USERS_FILE"];
  delete process.env["SESSION_SECRET"];
  delete process.env["AUTH_USER_1"];
  delete process.env["AUTH_PASSWORD_SHA256_1"];
  delete process.env["AUTH_NAME_1"];
  await rm(dir, { recursive: true, force: true });
});

function extractCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0]!;
}

describe("handleAuthApi", () => {
  it("zwraca null dla żądań spoza /api/auth/*", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(new Request("http://localhost/api/public/streams"));
    expect(res).toBeNull();
  });

  it("GET /api/auth/session bez ciasteczka: authenticated=false, lista bez ról", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(new Request("http://localhost/api/auth/session"));
    expect(res?.status).toBe(200);
    const data = (await res!.json()) as { authenticated: boolean; users: unknown[] };
    expect(data.authenticated).toBe(false);
    expect(data.users).toEqual([{ id: "alice", name: "Alice", accent: "primary" }]);
  });

  it("POST /api/auth/login z poprawnym hasłem → 200 + set-cookie", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "correct-password" }),
      }),
    );
    expect(res?.status).toBe(200);
    expect(res?.headers.get("set-cookie")).toContain("ytdl_session=");
  });

  it("POST /api/auth/login z błędnym hasłem → 401", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "wrong" }),
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("login → session → password (pełny przepływ z ciasteczkiem)", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const loginRes = await handleAuthApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "correct-password" }),
      }),
    );
    const cookie = extractCookie(loginRes!);

    const sessionRes = await handleAuthApi(
      new Request("http://localhost/api/auth/session", { headers: { cookie } }),
    );
    const sessionData = (await sessionRes!.json()) as { user: { role: string } | null };
    expect(sessionData.user?.role).toBe("admin"); // jedyne konto = bootstrap admin

    const changeRes = await handleAuthApi(
      new Request("http://localhost/api/auth/password", {
        method: "PUT",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "correct-password", newPassword: "new-password1" }),
      }),
    );
    expect(changeRes?.status).toBe(200);

    // Stare hasło już nie działa, nowe działa.
    const oldLoginRes = await handleAuthApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "correct-password" }),
      }),
    );
    expect(oldLoginRes?.status).toBe(401);

    const newLoginRes = await handleAuthApi(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", password: "new-password1" }),
      }),
    );
    expect(newLoginRes?.status).toBe(200);
  });

  it("PUT /api/auth/password bez sesji → 401", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(
      new Request("http://localhost/api/auth/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "x", newPassword: "new-password1" }),
      }),
    );
    expect(res?.status).toBe(401);
  });

  it("POST /api/auth/logout czyści ciasteczko", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(
      new Request("http://localhost/api/auth/logout", { method: "POST" }),
    );
    expect(res?.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("nieznana ścieżka pod prefiksem → 404", async () => {
    const { handleAuthApi } = await import("./gateway.server");
    const res = await handleAuthApi(new Request("http://localhost/api/auth/unknown"));
    expect(res?.status).toBe(404);
  });
});
