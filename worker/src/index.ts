import { JobManager, QUALITY_OPTIONS, type JobDto } from "./jobs";
import { jobStreamToken, verifyBearer, verifyJobToken } from "./tokens";

/**
 * Worker yt-dlp — osobna usługa HTTP (Model A, kontrakt §1.1).
 *
 * Endpointy (auth: Bearer WORKER_TOKEN; /events i /files dodatkowo/alternatywnie
 * akceptują ?token= — HMAC joba, bo przeglądarka nie ustawia nagłówków):
 *   GET    /health
 *   POST   /jobs                 {url, format, quality} → {jobs: [...]}
 *   GET    /jobs                 → {jobs: [...]}
 *   DELETE /jobs/:id             → {ok: true}
 *   POST   /jobs/:id/retry       → {jobs: [...]}
 *   GET    /jobs/:id/events      → SSE (event: job, heartbeat 15 s, §9)
 *   GET    /files/:id            → strumień pliku (Content-Disposition)
 */

const PORT = Number(process.env["PORT"] ?? "8081");
const SECRET = process.env["WORKER_TOKEN"] ?? "";

if (!SECRET) {
  console.error("[worker] WORKER_TOKEN is required — refusing to start.");
  process.exit(1);
}

const manager = new JobManager(SECRET);

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

function withStreamToken(dto: JobDto): JobDto {
  return { ...dto, streamToken: jobStreamToken(dto.id, SECRET) };
}

function authorized(request: Request): boolean {
  return verifyBearer(request.headers.get("authorization"), SECRET);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const raw = await request.text();
  if (raw.length > 64 * 1024) {
    throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("bad");
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Nieprawidłowy JSON"), { statusCode: 400 });
  }
}

function parseStartInput(body: Record<string, unknown>): {
  url: string;
  format: "mp3" | "mp4";
  quality: string;
} {
  const url = typeof body["url"] === "string" ? body["url"].trim() : "";
  const format = body["format"];
  const quality = typeof body["quality"] === "string" ? body["quality"] : "";

  if (!/^https?:\/\//i.test(url) || url.length > 2048) {
    throw Object.assign(new Error("Nieprawidłowy adres URL"), { statusCode: 400 });
  }
  if (format !== "mp3" && format !== "mp4") {
    throw Object.assign(new Error("Format musi być mp3 lub mp4"), { statusCode: 400 });
  }
  if (!QUALITY_OPTIONS[format].includes(quality)) {
    throw Object.assign(new Error("Niedozwolona jakość dla wybranego formatu"), {
      statusCode: 400,
    });
  }
  return { url, format, quality };
}

/** SSE: event: job + heartbeat 15 s; zamknięcie po statusie terminalnym (§9). */
function jobEventsStream(jobId: string): Response {
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (dto: JobDto) => {
        try {
          controller.enqueue(encoder.encode(`event: job\ndata: ${JSON.stringify(dto)}\n\n`));
        } catch {
          // strumień już zamknięty
        }
      };

      const current = manager.get(jobId);
      if (current) send(current);
      if (current && ["done", "error", "canceled"].includes(current.status)) {
        controller.close();
        return;
      }

      const unsubscribe = manager.subscribe(jobId, (dto) => {
        send(dto);
        if (["done", "error", "canceled"].includes(dto.status)) {
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
      // rozłączenie klienta — sprzątamy subskrypcję i heartbeat
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

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120) || "plik";
}

async function fileResponse(
  jobId: string,
  token: string | null,
  bearerOk: boolean,
): Promise<Response> {
  const dto = manager.get(jobId);
  if (!dto || dto.status !== "done") {
    return json({ error: "Plik nie jest dostępny" }, 404);
  }
  if (!verifyJobToken(jobId, token, SECRET) && !bearerOk) {
    return json({ error: "Invalid token" }, 403);
  }
  const path = await manager.resolveFilePath(jobId);
  if (!path) return json({ error: "Plik nie istnieje" }, 404);

  const file = Bun.file(path);
  const displayName = dto.outputPath ?? jobId;
  const asciiName = sanitizeFilename(displayName);
  return new Response(file, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(file.size),
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
      "cache-control": "no-store",
    },
  });
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ ok: true });
    }

    const bearerOk = authorized(request);
    if (!bearerOk) {
      return json({ error: "Unauthorized" }, 401);
    }

    try {
      if (path === "/jobs" && request.method === "POST") {
        const input = parseStartInput(await readJson(request));
        const jobs = manager.create(input);
        return json({ jobs: jobs.map(withStreamToken) });
      }

      if (path === "/jobs" && request.method === "GET") {
        return json({ jobs: manager.list().map(withStreamToken) });
      }

      const jobMatch = /^\/jobs\/([0-9a-fA-F-]{36})$/.exec(path);
      if (jobMatch) {
        const jobId = jobMatch[1]!;
        if (request.method === "DELETE") {
          manager.cancel(jobId);
          return json({ ok: true });
        }
        if (request.method === "GET") {
          const dto = manager.get(jobId);
          return dto ? json({ job: withStreamToken(dto) }) : json({ error: "Not found" }, 404);
        }
      }

      const retryMatch = /^\/jobs\/([0-9a-fA-F-]{36})\/retry$/.exec(path);
      if (retryMatch && request.method === "POST") {
        const jobs = manager.retry(retryMatch[1]!);
        return json({ jobs: jobs.map(withStreamToken) });
      }

      const eventsMatch = /^\/jobs\/([0-9a-fA-F-]{36})\/events$/.exec(path);
      if (eventsMatch && request.method === "GET") {
        const jobId = eventsMatch[1]!;
        const token = url.searchParams.get("token");
        if (!verifyJobToken(jobId, token, SECRET)) {
          return json({ error: "Invalid token" }, 403);
        }
        return jobEventsStream(jobId);
      }

      const fileMatch = /^\/files\/([0-9a-fA-F-]{36})$/.exec(path);
      if (fileMatch && request.method === "GET") {
        return await fileResponse(fileMatch[1]!, url.searchParams.get("token"), bearerOk);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  },
});

console.log(`[worker] listening on :${PORT}`);
