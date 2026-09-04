import { describe, expect, it } from "vitest";
import { sha256Hex } from "./crypto.server";
import { hashPassword, needsRehash, verifyPassword } from "./password.server";

describe("hashPassword / verifyPassword (pbkdf2)", () => {
  it("weryfikuje poprawne hasło", async () => {
    const record = hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", record)).resolves.toBe(true);
  });

  it("odrzuca niepoprawne hasło", async () => {
    const record = hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", record)).resolves.toBe(false);
  });

  it("dwa hashe tego samego hasła różnią się (losowa sól)", () => {
    const a = hashPassword("same-password");
    const b = hashPassword("same-password");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it("needsRehash false dla świeżego pbkdf2", () => {
    expect(needsRehash(hashPassword("x"))).toBe(false);
  });
});

describe("verifyPassword (legacy sha256 — bootstrap ze starego .env)", () => {
  it("weryfikuje hasło zgodne ze starym AUTH_PASSWORD_SHA256_n", async () => {
    const legacyHash = await sha256Hex("legacy-password");
    const record = { algo: "sha256" as const, hash: legacyHash };
    await expect(verifyPassword("legacy-password", record)).resolves.toBe(true);
  });

  it("odrzuca niepoprawne hasło dla rekordu legacy", async () => {
    const legacyHash = await sha256Hex("legacy-password");
    const record = { algo: "sha256" as const, hash: legacyHash };
    await expect(verifyPassword("nope", record)).resolves.toBe(false);
  });

  it("needsRehash true dla rekordu legacy", async () => {
    const legacyHash = await sha256Hex("x");
    expect(needsRehash({ algo: "sha256", hash: legacyHash })).toBe(true);
  });
});
