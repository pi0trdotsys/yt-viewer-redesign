import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test integracyjny: `createHandler()` z podstawionymi `YT_DLP_BIN`/
 * `FFMPEG_BIN` (atrapy — proste skrypty shell, zero sieci/realnego
 * yt-dlp/ffmpeg). Ćwiczy cały łańcuch dodany w tej sesji: `spawnYtdlToFifo`
 * (yt-dlp -o - | cat > fifo) → FIFO → ffmpeg (tu: atrapa czytająca FIFO i
 * przepisująca bajty) → strumień HTTP odpowiedzi, plus bilet/SSE/autoryzację.
 *
 * Atrapa ffmpeg celowo NIE robi żadnego realnego transkodowania (byle jakie
 * bajty ze stuba yt-dlp i tak nie są poprawnym audio) — testuje wyłącznie,
 * że *nasza* hydraulika (proces → FIFO → proces → Response) dowozi bajty
 * bez strat, co jest właśnie tym, co było zepsute przed naprawą w tej sesji.
 */

const SECRET = "test-worker-secret";
const FAKE_MEDIA = "FAKE_MEDIA_BYTES_1234567890";

let binDir: string;

beforeAll(async () => {
  binDir = await mkdtemp(join(tmpdir(), "worker-app-test-bin-"));

  const stubYtDlp = `#!/bin/sh
case "$*" in
  *--dump-single-json*)
    echo '{"title":"Stub Video","duration":42,"thumbnail":"https://example.com/thumb.jpg"}'
    ;;
  *)
    echo "YTDLPROG|500|1000|100000|1" 1>&2
    printf '%s' '${FAKE_MEDIA}'
    ;;
esac
`;
  const stubFfmpeg = `#!/bin/sh
prev=""
input=""
for arg in "$@"; do
  if [ "$prev" = "-i" ]; then input="$arg"; fi
  prev="$arg"
done
cat "$input"
`;

  const ytDlpPath = join(binDir, "yt-dlp-stub.sh");
  const ffmpegPath = join(binDir, "ffmpeg-stub.sh");
  await writeFile(ytDlpPath, stubYtDlp, "utf8");
  await writeFile(ffmpegPath, stubFfmpeg, "utf8");
  await chmod(ytDlpPath, 0o755);
  await chmod(ffmpegPath, 0o755);

  process.env["YT_DLP_BIN"] = ytDlpPath;
  process.env["FFMPEG_BIN"] = ffmpegPath;
});

afterAll(async () => {
  delete process.env["YT_DLP_BIN"];
  delete process.env["FFMPEG_BIN"];
  await rm(binDir, { recursive: true, force: true });
});

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { authorization: `Bearer ${SECRET}`, "x-user-id": "tester", ...extra };
}

describe("createHandler — integracja z atrapami yt-dlp/ffmpeg", () => {
  it("odrzuca żądania bez Bearer token", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);
    const res = await handle(new Request("http://localhost/streams"));
    expect(res.status).toBe(401);
  });

  it("GET /health nie wymaga autoryzacji", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);
    const res = await handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("POST /streams z nieprawidłowym URL → 400", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);
    const res = await handle(
      new Request("http://localhost/streams", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ url: "not-a-url", format: "mp3", quality: "320kbps" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("pełny przepływ: POST → SSE → GET pobiera dokładnie bajty ze stuba", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);

    const createRes = await handle(
      new Request("http://localhost/streams", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          format: "mp3",
          quality: "320kbps",
        }),
      }),
    );
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as {
      kind: string;
      id: string;
      token: string;
      title?: string;
      durationSec?: number;
    };
    expect(created.kind).toBe("video");
    expect(created.title).toBe("Stub Video");
    expect(created.durationSec).toBe(42);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    // Zły token na /events → 403.
    const badEventsRes = await handle(
      new Request(`http://localhost/streams/${created.id}/events?token=wrong`, {
        headers: authHeaders(),
      }),
    );
    expect(badEventsRes.status).toBe(403);

    // Zły token na pobranie → 403, bilet NIE jest konsumowany.
    const badDownloadRes = await handle(
      new Request(`http://localhost/streams/${created.id}?token=wrong`, {
        headers: authHeaders(),
      }),
    );
    expect(badDownloadRes.status).toBe(403);

    // Właściwe pobranie: bajty muszą być IDENTYCZNE z tym, co "yt-dlp"
    // napisał do FIFO — to jest dokładnie ścieżka naprawiona w tej sesji
    // (yt-dlp -o - | cat > fifo, zamiast yt-dlp -o <fifo> wprost).
    const downloadUrl = `http://localhost/streams/${created.id}?token=${created.token}`;
    const downloadRes = await handle(new Request(downloadUrl, { headers: authHeaders() }));
    expect(downloadRes.status).toBe(200);
    const body = await downloadRes.text();
    expect(body).toBe(FAKE_MEDIA);
    expect(downloadRes.headers.get("content-disposition")).toContain("Stub Video");

    // Bilet jednorazowy — drugie pobranie tym samym tokenem odrzucone.
    const secondDownloadRes = await handle(new Request(downloadUrl, { headers: authHeaders() }));
    expect(secondDownloadRes.status).toBe(409);

    // SSE po zakończeniu: pojedyncza ramka ze statusem "done".
    const eventsRes = await handle(
      new Request(`http://localhost/streams/${created.id}/events?token=${created.token}`, {
        headers: authHeaders(),
      }),
    );
    expect(eventsRes.status).toBe(200);
    const sseBody = await eventsRes.text();
    expect(sseBody).toContain("event: stream");
    expect(sseBody).toContain('"status":"done"');
  });

  it("izolacja per-user: X-User-Id innego usera nie widzi cudzego biletu", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);

    const createRes = await handle(
      new Request("http://localhost/streams", {
        method: "POST",
        headers: { ...authHeaders({ "x-user-id": "owner" }), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          format: "mp3",
          quality: "320kbps",
        }),
      }),
    );
    const created = (await createRes.json()) as { id: string; token: string };

    const otherUserRes = await handle(
      new Request(`http://localhost/streams/${created.id}?token=${created.token}`, {
        headers: authHeaders({ "x-user-id": "intruder" }),
      }),
    );
    expect(otherUserRes.status).toBe(404);
  });

  it("DELETE anuluje bilet jeszcze nieskonsumowany", async () => {
    const { createHandler } = await import("./app");
    const handle = createHandler(SECRET);

    const createRes = await handle(
      new Request("http://localhost/streams", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          format: "mp3",
          quality: "320kbps",
        }),
      }),
    );
    const created = (await createRes.json()) as { id: string; token: string };

    const cancelRes = await handle(
      new Request(`http://localhost/streams/${created.id}`, {
        method: "DELETE",
        headers: authHeaders(),
      }),
    );
    expect(cancelRes.status).toBe(200);

    const eventsRes = await handle(
      new Request(`http://localhost/streams/${created.id}/events?token=${created.token}`, {
        headers: authHeaders(),
      }),
    );
    const sseBody = await eventsRes.text();
    expect(sseBody).toContain('"status":"canceled"');
  });
});
