/**
 * Błąd z kodem HTTP — ten sam, sprawdzony wzorzec co `httpError()` w
 * `worker/src/streams.ts`. Rzucany przez `users.store.server.ts`, łapany w
 * `admin.gateway.server.ts`/`gateway.server.ts` i mapowany na JSON.
 */
export interface HttpError extends Error {
  statusCode: number;
}

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

export function errorStatus(error: unknown): number {
  const err = error as { statusCode?: unknown };
  return typeof err.statusCode === "number" ? err.statusCode : 500;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
