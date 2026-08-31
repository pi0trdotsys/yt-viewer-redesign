import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Token strumienia (kontrakt §9): HMAC-SHA256(jobId, WORKER_TOKEN),
 * weryfikowany w czasie stałym na endpointach /jobs/:id/events i /files/:id.
 */

export function jobStreamToken(jobId: string, secret: string): string {
  return createHmac("sha256", secret).update(jobId).digest("hex").slice(0, 32);
}

export function verifyJobToken(jobId: string, token: string | null, secret: string): boolean {
  if (!secret || !token) return false;
  const expected = jobStreamToken(jobId, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function verifyBearer(header: string | null, secret: string): boolean {
  if (!secret) return false;
  const provided = bearerValue(header);
  if (!provided) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function bearerValue(header: string | null): string {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match ? match[1]!.trim() : "";
}
