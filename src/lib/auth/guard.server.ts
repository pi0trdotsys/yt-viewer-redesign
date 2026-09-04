import { getSessionUser } from "./session.server";

/**
 * Ochrona stron (SSR): `/` i `/admin` wymagają sesji (`/admin` dodatkowo
 * roli admina), `/login` przekierowuje dalej gdy użytkownik już jest
 * zalogowany. Wywoływane identycznie z `src/server.ts` (produkcja) i
 * `plugins/downloader-gateway-dev.ts` (dev), żeby ochrona działała w obu
 * trybach.
 *
 * Świadomie NIE gatujemy niczego poza dokładnie `/`, `/admin` i `/login` —
 * pozostałe ścieżki (assety JS/CSS, fonty, favicon) muszą zostać publiczne,
 * bo strona logowania musi się załadować zanim jest sesja.
 */
export async function guardPageRequest(request: Request): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  const { pathname, origin } = new URL(request.url);
  const user = await getSessionUser(request);
  const authenticated = user !== null;

  if ((pathname === "/" || pathname === "/admin") && !authenticated) {
    return Response.redirect(new URL("/login", origin), 302);
  }
  if (pathname === "/login" && authenticated) {
    return Response.redirect(new URL("/", origin), 302);
  }
  if (pathname === "/admin" && authenticated && user.role !== "admin") {
    return Response.redirect(new URL("/", origin), 302);
  }
  return null;
}
