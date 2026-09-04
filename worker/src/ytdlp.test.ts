import { describe, expect, it } from "bun:test";
import { PROGRESS_PREFIX, classifyError, parseProgressLine, shQuote } from "./ytdlp";

describe("parseProgressLine", () => {
  it("parsuje poprawną linię postępu", () => {
    const line = `${PROGRESS_PREFIX}1048576|10485760|524288|18`;
    expect(parseProgressLine(line)).toEqual({
      downloadedBytes: 1048576,
      totalBytes: 10485760,
      speedBytesPerSec: 524288,
      etaSec: 18,
    });
  });

  it("zwraca null dla linii bez prefiksu", () => {
    expect(parseProgressLine("[download] Destination: foo.mp4")).toBeNull();
  });

  it("obsługuje brakujące/NA pola jako undefined", () => {
    const line = `${PROGRESS_PREFIX}NA|NA|NA|NA`;
    expect(parseProgressLine(line)).toEqual({
      downloadedBytes: undefined,
      totalBytes: undefined,
      speedBytesPerSec: undefined,
      etaSec: undefined,
    });
  });

  it("odrzuca liczby ujemne (traktuje jako undefined)", () => {
    const line = `${PROGRESS_PREFIX}-5|100|10|5`;
    expect(parseProgressLine(line)?.downloadedBytes).toBeUndefined();
  });
});

describe("classifyError", () => {
  it("rozpoznaje geoblokadę", () => {
    expect(classifyError("This video is not available in your country")).toBe("GEO");
  });

  it("rozpoznaje film prywatny", () => {
    expect(classifyError("ERROR: Private video. Sign in if you've been granted access")).toBe(
      "PRIVATE",
    );
  });

  it("rozpoznaje nieznaleziony film", () => {
    expect(classifyError("ERROR: [youtube] abc123: Video unavailable")).toBe("NOT_FOUND");
  });

  it("rozpoznaje ograniczenie wiekowe", () => {
    expect(classifyError("Sign in to confirm your age")).toBe("AGE");
  });

  it("rozpoznaje brak miejsca na dysku", () => {
    expect(classifyError("OSError: [Errno 28] No space left on device")).toBe("DISK");
  });

  it("rozpoznaje błąd sieci", () => {
    expect(
      classifyError("urlopen error [Errno -2] Name or service not known: getaddrinfo failed"),
    ).toBe("NETWORK");
  });

  it("nierozpoznany komunikat → UNKNOWN", () => {
    expect(classifyError("something completely unexpected happened")).toBe("UNKNOWN");
  });

  it("jest niewrażliwy na wielkość liter", () => {
    expect(classifyError("PRIVATE VIDEO")).toBe("PRIVATE");
  });
});

describe("shQuote", () => {
  it("owija zwykły tekst w pojedyncze cudzysłowy", () => {
    expect(shQuote("hello")).toBe("'hello'");
  });

  it("bezpiecznie escape'uje pojedynczy cudzysłów", () => {
    // 'it'\''s' — standardowy POSIX trik zamykania/otwierania cudzysłowu
    expect(shQuote("it's")).toBe("'it'\\''s'");
  });

  it("neutralizuje typowe metaznaki powłoki (injection)", () => {
    const malicious = "https://example.com/$(rm -rf /); echo pwned";
    const quoted = shQuote(malicious);
    // Cały ciąg musi być pojedynczym cytowanym literałem — żadne '$(' czy
    // ';' nie mogą wyjść poza cudzysłowy jako aktywna składnia powłoki.
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.endsWith("'")).toBe(true);
    expect(quoted).toContain(malicious.replace(/'/g, "'\\''"));
  });

  it("pusty string daje pustą parę cudzysłowów", () => {
    expect(shQuote("")).toBe("''");
  });
});
