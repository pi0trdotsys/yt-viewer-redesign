import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatEta, formatSpeed } from "./types";

describe("formatBytes", () => {
  it("zwraca em-dash dla undefined/NaN", () => {
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });

  it("formatuje bajty bez jednostki dziesiętnej", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formatuje KB/MB/GB z jedną cyfrą po przecinku poniżej 100", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("bez miejsc po przecinku od 100 w górę", () => {
    expect(formatBytes(150 * 1024)).toBe("150 KB");
  });
});

describe("formatSpeed", () => {
  it("dokleja /s do formatBytes", () => {
    expect(formatSpeed(1024)).toBe("1.0 KB/s");
  });
  it("em-dash dla undefined", () => {
    expect(formatSpeed(undefined)).toBe("—");
  });
});

describe("formatEta", () => {
  it("em-dash dla undefined/ujemnych/NaN", () => {
    expect(formatEta(undefined)).toBe("—");
    expect(formatEta(-5)).toBe("—");
    expect(formatEta(Number.NaN)).toBe("—");
  });

  it("tylko sekundy poniżej minuty", () => {
    expect(formatEta(42)).toBe("42s");
    expect(formatEta(0)).toBe("0s");
  });

  it("minuty i sekundy z paddingiem", () => {
    expect(formatEta(65)).toBe("1m 05s");
    expect(formatEta(600)).toBe("10m 00s");
  });
});

describe("formatDuration", () => {
  it("em-dash dla undefined/NaN", () => {
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });

  it("format m:ss z paddingiem", () => {
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(213)).toBe("3:33");
    expect(formatDuration(5)).toBe("0:05");
  });
});
