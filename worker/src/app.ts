import { QUALITY_OPTIONS, StreamRegistry, httpError, type StartInput, type StreamDto } from "./streams";
import { verifyBearer, verifyTicketToken } from "./tokens";

/**
 * Routing HTTP wydzielony z `index.ts` (który tylko woła `Bun.serve`) — dzięki
 * temu `createHandler()` da się zaimportować i przetestować bez sieci/procesu
 * nasłuchującego, podstawiając `YT_DLP_BIN`/`FFMPEG_BIN` atrapami.
 *
 * Endpointy (auth: Bearer WORKER_TOKEN; /events i pobranie dodatkowo wymagają
 * ?token= — ticket HMAC, bo przeglądarka nie ustawia nagłówków przy
 * EventSource/nawigacji pobierania):
 *   GET    /health
 *   POST   /streams              {url, format, quality} → bilet (wideo) albo
 *                                 lista pozycji (playlista) — bez zapisu na dysk
 *   GET    /streams/:id/events   → SSE (event: stream, heartbeat 15 s)
 *   GET    /streams/:id          → uruchamia pipeline i strumieniuje wynik
 *                                   prosto do przeglądarki; bilet jednorazowy
 *   DELETE /streams/:id          → anulowanie (kill procesów pipeline'u)
 *
 * Zero plików na dysku poza FIFO w katalogu tymczasowym dla mp4 (czyste
 * pipe'y jądra, sprzątane w `StreamRegistry.teardown`).
 *
 * Izolacja per-user: gateway (jedyny wołający, port workera nie jest
 * publikowany) ustawia nagłówek X-User-Id z id zalogowanego usera po
 * weryfikacji sesji. Worker filtruje nim wszystkie operacje na bilecie.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function errorResponse(error: unknown): Response {
  const err = error as { statusCode?: number; message?: string };
  const status = typeof err.statusCode === "number" ? err.statusCode : 500;
  return json({ error: err.message ?? "Błąd wewnętrzny workera" }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 64 * 1024) throw httpError(413, "Payload too large");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("bad");
    return parsed as Record<string, unknown>;
  } catch {
    throw httpError(400, "Nieprawidłowy JSON");
  }
}

export function parseStartInput(body: Record<string, unknown>): StartInput {
  const url = typeof body["url"] === "string" ? body["url"].trim() : "";
  const format = body["format"];
  const quality = typeof body["quality"] === "string" ? body["quality"] : "";

  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    throw httpError(400, "Nieprawidłowy adres URL");
  }
  if (format !== "mp3" && format !== "mp4") {
    throw httpError(400, "Format musi być mp3 lub mp4");
  }
  if (!QUALITY_OPTIONS[format].includes(quality)) {
    throw httpError(400, "Niedozwolona jakość dla wybranego formatu");
  }
  return { url, format, quality };
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "plik";
}

const TERMINAL_STATUSES = new Set<StreamDto["status"]>(["done", "error", "canceled"]);

/** SSE: event: stream + heartbeat 15 s; zamknięcie po statusie terminalnym. */
function sseResponse(registry: StreamRegistry, id: string, ownerId: string): Response {
  const current = registry.get(id, ownerId);
  if (!current) return json({ error: "Not found" }, 404);

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (dto: StreamDto) => {
        try {
          controller.enqueue(encoder.encode(`event: stream\ndata: ${JSON.stringify(dto)}\n\n`));
        } catch {
          // strumień już zamknięty
        }
      };

      send(current);
      if (TERMINAL_STATUSES.has(current.status)) {
        controller.close();
        return;
      }

      const unsubscribe = registry.subscribe(id, (dto) => {
        send(dto);
        if (TERMINAL_STATUSES.has(dto.status)) {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // już zamknięty
            }
          }, 100);
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    },
    cancel() {
      cleanup?.();
      cleanup = undefined;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export function createHandler(secret: string): (request: Request) => Promise<Response> {
  const registry = new StreamRegistry(secret);

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ ok: true });
    }

    if (!verifyBearer(request.headers.get("authorization"), secret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    // Kto woła — nagłówek ustawiany przez gateway po weryfikacji sesji
    // (izolacja per-user). Pusty ownerId po prostu nie dopasuje żadnego
    // realnego biletu (fail-closed).
    const ownerId = (request.headers.get("x-user-id") ?? "").trim().slice(0, 128);

    try {
      if (path === "/streams" && request.method === "POST") {
        const input = parseStartInput(await readJson(request));
        const result = await registry.create(input, ownerId);
        if (result.kind === "playlist") {
          return json({ kind: "playlist", title: result.title, entries: result.entries });
        }
        return json({ kind: "video", ...result.dto, token: result.token });
      }

      const eventsMatch = /^\/streams\/([0-9a-fA-F-]{36})\/events$/.exec(path);
      if (eventsMatch && request.method === "GET") {
        const id = eventsMatch[1]!;
        const token = url.searchParams.get("token");
        if (!verifyTicketToken(id, token, secret)) {
          return json({ error: "Invalid token" }, 403);
        }
        return sseResponse(registry, id, ownerId);
      }

      const streamMatch = /^\/streams\/([0-9a-fA-F-]{36})$/.exec(path);
      if (streamMatch) {
        const id = streamMatch[1]!;

        if (request.method === "GET") {
          const token = url.searchParams.get("token");
          const { stream, filename } = await registry.consume(id, token, ownerId);
          const asciiName = sanitizeFilename(filename);
          return new Response(stream, {
            headers: {
              "content-type": "application/octet-stream",
              "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
              "cache-control": "no-store",
            },
          });
        }

        if (request.method === "DELETE") {
          registry.cancel(id, ownerId);
          return json({ ok: true });
        }
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
