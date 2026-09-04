import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "./types.shared";

// users.store.server robi I/O na plikach — dla testów samej logiki sesji
// (podpis/expiry/manipulacja) wystarczy atrapa findSessionUser.
const findSessionUser = vi.fn<(id: string) => Promise<SessionUser | null>>();
vi.mock("./users.store.server", () => ({
  findSessionUser: (id: string) => findSessionUser(id),
}));

const ALICE: SessionUser = { id: "alice", name: "Alice", accent: "primary", role: "user" };

describe("session.server", () => {
  const ORIGINAL_ENV = process.env["SESSION_SECRET"];

  beforeEach(() => {
    process.env["SESSION_SECRET"] = "test-secret";
    findSessionUser.mockReset();
    findSessionUser.mockResolvedValue(ALICE);
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env["SESSION_SECRET"];
    else process.env["SESSION_SECRET"] = ORIGINAL_ENV;
  });

  function requestWithCookie(cookieHeaderValue: string): Request {
    return new Request("http://localhost/", { headers: { cookie: cookieHeaderValue } });
  }

  it("round-trip: ciasteczko wydane przez createSessionCookieHeader jest akceptowane", async () => {
    const { createSessionCookieHeader, getSessionUser, SESSION_COOKIE_NAME } =
      await import("./session.server");
    const setCookie = createSessionCookieHeader("alice");
    const cookieValue = setCookie.split(";")[0]!; // "ytdl_session=..."
    expect(cookieValue.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true);

    const user = await getSessionUser(requestWithCookie(cookieValue));
    expect(user).toEqual(ALICE);
    expect(findSessionUser).toHaveBeenCalledWith("alice");
  });

  it("brak ciasteczka → null", async () => {
    const { getSessionUser } = await import("./session.server");
    const user = await getSessionUser(new Request("http://localhost/"));
    expect(user).toBeNull();
  });

  it("brak SESSION_SECRET → zawsze null (fail-closed)", async () => {
    const { createSessionCookieHeader, getSessionUser } = await import("./session.server");
    const setCookie = createSessionCookieHeader("alice");
    delete process.env["SESSION_SECRET"];
    const user = await getSessionUser(requestWithCookie(setCookie.split(";")[0]!));
    expect(user).toBeNull();
  });

  it("zmanipulowany podpis odrzucony", async () => {
    const { createSessionCookieHeader, getSessionUser, SESSION_COOKIE_NAME } =
      await import("./session.server");
    const setCookie = createSessionCookieHeader("alice");
    const raw = setCookie.split(";")[0]!.slice(SESSION_COOKIE_NAME.length + 1);
    const [encodedId, expiresAt] = raw.split(".");
    const tampered = `${SESSION_COOKIE_NAME}=${encodedId}.${expiresAt}.deadbeef00000000000000000000000000000000000000000000000000000000`;
    const user = await getSessionUser(requestWithCookie(tampered));
    expect(user).toBeNull();
    expect(findSessionUser).not.toHaveBeenCalled();
  });

  it("wygasłe ciasteczko odrzucone", async () => {
    vi.useFakeTimers();
    try {
      const { createSessionCookieHeader, getSessionUser } = await import("./session.server");
      vi.setSystemTime(0);
      const setCookie = createSessionCookieHeader("alice");
      // 30 dni + 1ms w przyszłości
      vi.setSystemTime(30 * 24 * 60 * 60 * 1000 + 1);
      const user = await getSessionUser(requestWithCookie(setCookie.split(";")[0]!));
      expect(user).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clearSessionCookieHeader ustawia Max-Age=0", async () => {
    const { clearSessionCookieHeader } = await import("./session.server");
    expect(clearSessionCookieHeader()).toContain("Max-Age=0");
  });

  it("nieznany format ciasteczka (nie 3 segmenty) odrzucony", async () => {
    const { getSessionUser, SESSION_COOKIE_NAME } = await import("./session.server");
    const user = await getSessionUser(requestWithCookie(`${SESSION_COOKIE_NAME}=garbage`));
    expect(user).toBeNull();
  });
});
