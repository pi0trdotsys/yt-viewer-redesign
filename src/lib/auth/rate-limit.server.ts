/**
 * Prosty in-memory rate-limit prób logowania per userId (analogiczny wzorzec
 * do stanu w pamięci `JobManager` w workerze). Nie jest rozproszony — dla
 * self-hostowanej appki na jednym procesie to wystarczające zabezpieczenie
 * przed brute-force.
 */

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000; // 5 minut

interface Attempt {
  count: number;
  windowStartedAt: number;
}

const attempts = new Map<string, Attempt>();

export function isRateLimited(key: string): boolean {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.windowStartedAt > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedAttempt(key: string): void {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStartedAt: now });
    return;
  }
  entry.count += 1;
}

export function clearAttempts(key: string): void {
  attempts.delete(key);
}
