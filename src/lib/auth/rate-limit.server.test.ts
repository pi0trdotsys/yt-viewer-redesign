import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAttempts, isRateLimited, recordFailedAttempt } from "./rate-limit.server";

// Modul trzyma stan w module-scope Map — klucze unikalne per test, żeby się
// nie przenikały (patrz plan: "znane pułapki").
function uniqueKey(name: string): string {
  return `${name}-${Math.random().toString(36).slice(2)}`;
}

describe("rate-limit.server", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("nie jest zlimitowany przy braku prób", () => {
    expect(isRateLimited(uniqueKey("fresh"))).toBe(false);
  });

  it("limituje po 5 nieudanych próbach", () => {
    const key = uniqueKey("brute");
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    expect(isRateLimited(key)).toBe(true);
  });

  it("nie limituje po 4 próbach", () => {
    const key = uniqueKey("almost");
    for (let i = 0; i < 4; i++) recordFailedAttempt(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("clearAttempts resetuje licznik", () => {
    const key = uniqueKey("reset");
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    expect(isRateLimited(key)).toBe(true);
    clearAttempts(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("okno 5 minut wygasa i odblokowuje próby", () => {
    vi.useFakeTimers();
    const key = uniqueKey("window");
    vi.setSystemTime(0);
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    expect(isRateLimited(key)).toBe(true);

    vi.setSystemTime(5 * 60 * 1000 + 1);
    expect(isRateLimited(key)).toBe(false);
  });
});
