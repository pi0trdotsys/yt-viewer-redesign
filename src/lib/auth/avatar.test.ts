import { describe, expect, it } from "vitest";
import { accentClasses, initials } from "./avatar";

describe("initials", () => {
  it("dwie litery z jednego słowa", () => {
    expect(initials("Alice")).toBe("AL");
  });

  it("pierwsze litery dwóch pierwszych/ostatnich słów", () => {
    expect(initials("Jan Kowalski")).toBe("JK");
  });

  it("wiele słów bierze pierwsze i ostatnie", () => {
    expect(initials("Anna Maria Nowak")).toBe("AN");
  });

  it("zwraca ? dla pustego ciągu", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
  });
});

describe("accentClasses", () => {
  it("zwraca klasy navy dla accent=navy", () => {
    expect(accentClasses("navy").avatar).toContain("navy");
  });

  it("domyślnie (primary) nie zawiera navy", () => {
    expect(accentClasses("primary").avatar).not.toContain("navy");
  });
});
