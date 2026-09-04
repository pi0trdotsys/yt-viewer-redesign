import { describe, expect, it } from "bun:test";
import { ticketToken, verifyBearer, verifyTicketToken } from "./tokens";

describe("ticketToken / verifyTicketToken", () => {
  const secret = "test-secret";

  it("token wygenerowany dla biletu weryfikuje się poprawnie", () => {
    const token = ticketToken("ticket-123", secret);
    expect(verifyTicketToken("ticket-123", token, secret)).toBe(true);
  });

  it("token dla innego biletu nie pasuje", () => {
    const token = ticketToken("ticket-123", secret);
    expect(verifyTicketToken("ticket-456", token, secret)).toBe(false);
  });

  it("token podpisany innym sekretem nie pasuje", () => {
    const token = ticketToken("ticket-123", secret);
    expect(verifyTicketToken("ticket-123", token, "other-secret")).toBe(false);
  });

  it("null token → false", () => {
    expect(verifyTicketToken("ticket-123", null, secret)).toBe(false);
  });

  it("pusty sekret → zawsze false (fail-closed)", () => {
    const token = ticketToken("ticket-123", "");
    expect(verifyTicketToken("ticket-123", token, "")).toBe(false);
  });

  it("token jest deterministyczny (ten sam bilet+sekret → ten sam token)", () => {
    expect(ticketToken("ticket-123", secret)).toBe(ticketToken("ticket-123", secret));
  });
});

describe("verifyBearer", () => {
  const secret = "worker-token-secret";

  it("akceptuje poprawny nagłówek Bearer", () => {
    expect(verifyBearer(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("odrzuca zły token", () => {
    expect(verifyBearer("Bearer wrong-token", secret)).toBe(false);
  });

  it("odrzuca brak nagłówka", () => {
    expect(verifyBearer(null, secret)).toBe(false);
  });

  it("odrzuca zły format (bez 'Bearer ')", () => {
    expect(verifyBearer(secret, secret)).toBe(false);
  });

  it("odrzuca gdy sekret workera jest pusty", () => {
    expect(verifyBearer(`Bearer ${secret}`, "")).toBe(false);
  });

  it("jest case-insensitive na słowo Bearer", () => {
    expect(verifyBearer(`bearer ${secret}`, secret)).toBe(true);
  });
});
