import { getSessionUser } from "./session.server";

/**
 * Ochrona stron (SSR): `/` wymaga sesji, `/login` przekierowuje dalej gdy
 * użytkownik już jest zalogowany. Wywoływane identycznie z `src/server.ts`
 * (produkcja) i `plugins/downloader-gateway-dev.ts` (dev), żeby `/` było
 * chronione w obu trybach.
 *
 * Świadomie NIE gatujemy niczego poza dokładnie `/` i `/login` — pozostałe
 * ścieżki (assety JS/CSS, fonty, favicon) muszą zostać publiczne, bo strona
 * logowania musi się załadować zanim jest sesja.
 */
export function guardPageRequest(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const { pathname, origin } = new URL(request.url);
  const authenticated = getSessionUser(request) !== null;

  if (pathname === "/" && !authenticated) {
    return Response.redirect(new URL("/login", origin), 302);
  }
  if (pathname === "/login" && authenticated) {
    return Response.redirect(new URL("/", origin), 302);
  }
  return null;
}
