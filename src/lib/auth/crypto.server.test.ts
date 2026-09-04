import { describe, expect, it } from "vitest";
import { hmacHex, sha256Hex, timingSafeEqualHex } from "./crypto.server";

describe("sha256Hex", () => {
  it("zwraca znany wektor testowy SHA-256", async () => {
    // echo -n "abc" | sha256sum
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("różne wejścia dają różny hash", async () => {
    const a = await sha256Hex("hello");
    const b = await sha256Hex("hello!");
    expect(a).not.toBe(b);
  });
});

describe("hmacHex", () => {
  it("deterministyczny dla tego samego sekretu", () => {
    expect(hmacHex("payload", "secret")).toBe(hmacHex("payload", "secret"));
  });

  it("różny sekret daje różny podpis", () => {
    expect(hmacHex("payload", "secret1")).not.toBe(hmacHex("payload", "secret2"));
  });
});

describe("timingSafeEqualHex", () => {
  it("true dla identycznych ciągów", () => {
    expect(timingSafeEqualHex("abcd1234", "abcd1234")).toBe(true);
  });

  it("false dla różnych ciągów tej samej długości", () => {
    expect(timingSafeEqualHex("abcd1234", "abcd1235")).toBe(false);
  });

  it("false dla różnej długości (bez rzucania wyjątkiem)", () => {
    expect(timingSafeEqualHex("abc", "abcd")).toBe(false);
  });
});
