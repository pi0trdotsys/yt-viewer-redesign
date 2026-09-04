import { randomUUID } from "node:crypto";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  classifyError,
  cookieArgs,
  ffmpegBin,
  maxDurationSec,
  parseProgressLine,
  probe,
  progressArgs,
  spawnYtdlToFifo,
  ytdlBin,
  type JobErrorCode,
  type ProgressUpdate,
} from "./ytdlp";
import { ticketToken, verifyTicketToken } from "./tokens";

/**
 * Rejestr biletów pobierania — zastępuje dawny `JobManager`. Żaden plik
 * wynikowy nigdy nie trafia na dysk: `POST /streams` tylko sprawdza metadane
 * (`probe`) i zakłada bilet; realne pobranie (`consume`) spawnuje
 * yt-dlp(+ffmpeg) i strumieniuje bajty prosto do odpowiedzi HTTP wołającej
 * przeglądarki. Jedyny "dotyk dysku" to FIFO w katalogu tymczasowym dla mp4
 * (czyste pipe'y jądra, zero buforowanej zawartości), sprzątane zawsze w
 * `finally`.
 */

export type StreamStatus = "resolving" | "downloading" | "done" | "error" | "canceled";

export interface StreamDto {
  id: string;
  status: StreamStatus;
  progress: number;
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  speedBytesPerSec?: number;
  etaSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
  errorCode?: JobErrorCode;
}

export interface StartInput {
  url: string;
  format: "mp3" | "mp4";
  quality: string;
}

export const QUALITY_OPTIONS: Record<StartInput["format"], string[]> = {
  mp3: ["128kbps", "192kbps", "320kbps"],
  mp4: ["480p", "720p", "1080p", "1440p", "2160p"],
};

export type CreateResult =
  | { kind: "video"; dto: StreamDto; token: string }
  | { kind: "playlist"; title?: string; entries: string[] };

export interface HttpError extends Error {
  statusCode: number;
}

export function httpError(statusCode: number, message: string): HttpError {
  return Object.assign(new Error(message), { statusCode });
}

const execFileAsync = promisify(execFile);
const TERMINAL: StreamStatus[] = ["done", "error", "canceled"];
const EMIT_INTERVAL_MS = 250; // ≤4 emisje/s
const SWEEP_INTERVAL_MS = 60_000;

interface Killable {
  kill(): void;
}

interface InternalTicket {
  dto: StreamDto;
  ownerId: string;
  input: StartInput;
  expiresAt: number;
  consumed: boolean;
  canceled: boolean;
  processes: Killable[];
  tmpDir?: string;
  lastEmitAt: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  pendingDto: StreamDto | null;
}

export class StreamRegistry {
  private tickets = new Map<string, InternalTicket>();
  private subscribers = new Map<string, Set<(dto: StreamDto) => void>>();
  private secret: string;
  private maxConcurrent: number;
  private maxPlaylistItems: number;
  private ticketTtlMs: number;

  constructor(secret: string) {
    this.secret = secret;
    const concurrent = Number(process.env["MAX_CONCURRENT_STREAMS"] ?? "2");
    this.maxConcurrent = Number.isFinite(concurrent) && concurrent > 0 ? concurrent : 2;
    const playlist = Number(process.env["MAX_PLAYLIST_ITEMS"] ?? "25");
    this.maxPlaylistItems = Number.isFinite(playlist) && playlist > 0 ? playlist : 25;
    const ttlSec = Number(process.env["STREAM_TICKET_TTL_SEC"] ?? "120");
    this.ticketTtlMs = (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 120) * 1000;

    // Bilety nieużyte w porę (np. zamknięta karta między POST a kliknięciem)
    // po prostu wygasają z pamięci — nic na dysku do sprzątania.
    setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS).unref();
  }

  // --- API ------------------------------------------------------------------

  /** Faza resolving: metadane + bilet (wideo) albo lista pozycji (playlista). */
  async create(input: StartInput, ownerId: string): Promise<CreateResult> {
    const metadata = await probe(input.url);

    if (metadata.isPlaylist) {
      const entries = metadata.entries.slice(0, this.maxPlaylistItems);
      if (entries.length === 0) {
        throw httpError(400, "Playlista jest pusta lub niedostępna");
      }
      return { kind: "playlist", title: metadata.title, entries };
    }

    if (metadata.durationSec && metadata.durationSec > maxDurationSec()) {
      throw httpError(400, `Film przekracza limit długości (${maxDurationSec()} s)`);
    }

    const id = randomUUID();
    const dto: StreamDto = {
      id,
      status: "resolving",
      progress: 0,
      title: metadata.title,
      durationSec: metadata.durationSec,
      thumbnailUrl: metadata.thumbnailUrl,
    };
    const ticket: InternalTicket = {
      dto,
      ownerId,
      input,
      expiresAt: Date.now() + this.ticketTtlMs,
      consumed: false,
      canceled: false,
      processes: [],
      lastEmitAt: 0,
      pendingTimer: null,
      pendingDto: null,
    };
    this.tickets.set(id, ticket);
    return { kind: "video", dto, token: ticketToken(id, this.secret) };
  }

  get(id: string, ownerId: string): StreamDto | undefined {
    const ticket = this.tickets.get(id);
    return ticket && ticket.ownerId === ownerId ? ticket.dto : undefined;
  }

  subscribe(id: string, cb: (dto: StreamDto) => void): () => void {
    let set = this.subscribers.get(id);
    if (!set) {
      set = new Set();
      this.subscribers.set(id, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.subscribers.delete(id);
    };
  }

  /** Anulowanie jest no-opem dla nieistniejącego/cudzego biletu (izolacja per-user). */
  cancel(id: string, ownerId: string): void {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.ownerId !== ownerId || TERMINAL.includes(ticket.dto.status)) return;
    ticket.canceled = true;
    void this.teardown(ticket);
    if (!ticket.consumed) {
      this.finish(ticket, { ...ticket.dto, status: "canceled" });
    }
    // Jeśli już skonsumowany: kill() procesów przerwie strumień do
    // przeglądarki, co domknie stan przez ścieżkę błędu/end w consume().
  }

  /** Ile biletów ma aktualnie żywy potok (do limitu równoległości). */
  private activeCount(): number {
    let n = 0;
    for (const t of this.tickets.values()) {
      if (t.consumed && !TERMINAL.includes(t.dto.status)) n++;
    }
    return n;
  }

  /**
   * Konsumuje bilet: uruchamia właściwy potok i zwraca strumień bajtów +
   * nazwę pliku. Rzuca `HttpError` (przed wysłaniem jakichkolwiek nagłówków),
   * jeśli bilet nieznany/wygasły/już użyty, limit przekroczony, albo pipeline
   * padł w krótkim oknie startowym (patrz `runPipeline`).
   */
  async consume(
    id: string,
    token: string | null,
    ownerId: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; filename: string }> {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.ownerId !== ownerId) throw httpError(404, "Nie znaleziono biletu");
    if (!verifyTicketToken(id, token, this.secret)) throw httpError(403, "Nieprawidłowy token");
    if (ticket.consumed) throw httpError(409, "Ten link już został użyty");
    if (Date.now() > ticket.expiresAt) {
      this.tickets.delete(id);
      throw httpError(410, "Link wygasł — uruchom pobieranie ponownie");
    }
    if (this.activeCount() >= this.maxConcurrent) {
      throw httpError(429, "Za dużo aktywnych pobrań — spróbuj za chwilę");
    }

    ticket.consumed = true;
    this.emit(ticket, { ...ticket.dto, status: "downloading", progress: 0 });

    // Nazwa "surowa" (może zawierać unicode) — nadawca (app.ts) buduje z niej
    // zarówno ASCII-owy fallback jak i pełną wersję dla filename*=UTF-8''.
    const filename = `${ticket.dto.title ?? id}.${ticket.input.format}`;

    try {
      const stream = await this.runPipeline(ticket);
      return { stream, filename };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyError(message);
      // Ostatnie znaki, nie pierwsze: to tam jest właściwy błąd (ffmpeg/yt-dlp
      // najpierw drukują długi banner/nagłówek na stderr).
      const shown = message.slice(-512);
      this.finish(ticket, { ...ticket.dto, status: "error", errorCode: code, error: shown });
      await this.teardown(ticket);
      throw httpError(502, shown);
    }
  }

  // --- pipeline'y -------------------------------------------------------

  private async runPipeline(ticket: InternalTicket): Promise<ReadableStream<Uint8Array>> {
    const ffmpeg =
      ticket.input.format === "mp3"
        ? await this.spawnAudioPipeline(ticket)
        : await this.spawnVideoPipeline(ticket);
    return this.streamFromFfmpeg(ticket, ffmpeg);
  }

  /**
   * mp3: yt-dlp pisze bestaudio na stdout, powłokowy `|` leje to do `cat`,
   * `cat` pisze do FIFO (`spawnYtdlToFifo`, patrz obszerny komentarz w
   * ytdlp.ts po co ten pośredni `cat` — bezpośrednie `yt-dlp -o <fifo>`
   * gubi dane/zwraca "Invalid data found" w wyścigu z ffmpeg). ffmpeg
   * czyta ten sam FIFO jako swój argument `-i` i transkoduje na stdout.
   *
   * Historia: pierwotna wersja robiła `yt.stdout.pipe(ffmpeg.stdin)` (Node
   * jako pośrednik między dwoma potomnymi procesami) i cicho gubiła dane w
   * połowie transferu — yt-dlp kończył z kompletem bajtów, ale do
   * ffmpeg.stdin docierała tylko część, bez żadnego błędu po żadnej ze
   * stron. Node nigdy nie dotyka bajtów źródłowego audio w obecnej wersji —
   * tylko nadzoruje procesy i czyta już-gotowy mp3 ze stdout ffmpeg.
   */
  private async spawnAudioPipeline(ticket: InternalTicket): Promise<ChildProcess> {
    const bitrate = ticket.input.quality.replace(/[^0-9]/g, "") || "320";
    const tmpDir = await mkdtemp(join(tmpdir(), "ytstream-"));
    ticket.tmpDir = tmpDir;
    const audioFifo = join(tmpDir, "audio.fifo");
    await execFileAsync("mkfifo", [audioFifo]);

    const ytProc = spawnYtdlToFifo(
      ytdlBin(),
      ["--no-playlist", ...progressArgs(), ...cookieArgs(), "-f", "bestaudio"],
      ticket.input.url,
      audioFifo,
    );
    ytProc.onLine((line) => {
      const p = parseProgressLine(line);
      if (p) this.reportProgress(ticket, p);
    });
    ticket.processes.push(ytProc);

    const ffmpeg = spawn(
      ffmpegBin(),
      [
        "-hide_banner",
        "-i",
        audioFifo,
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        `${bitrate}k`,
        "-f",
        "mp3",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    ticket.processes.push({ kill: () => ffmpeg.kill("SIGTERM") });
    return ffmpeg;
  }

  /**
   * mp4: dwa `mkfifo` (video/audio) w katalogu tymczasowym, dwa równoległe
   * `yt-dlp -o - | cat > fifo` (`spawnYtdlToFifo` — patrz komentarz w
   * ytdlp.ts po co pośredni `cat`, zamiast `yt-dlp -o <fifo>` wprost), plus
   * własny `ffmpeg -c copy` mux do fragmented mp4 na stdout. Zweryfikowane
   * ręcznie: `--merge-output-format mp4` samego yt-dlp przy `-o -` po cichu
   * podmienia kontener na mpegts — to podejście daje realny, poprawnie
   * oznaczony mp4 (`ffprobe` → `format_name=mov,mp4,...`).
   */
  private async spawnVideoPipeline(ticket: InternalTicket): Promise<ChildProcess> {
    const height = ticket.input.quality.replace(/[^0-9]/g, "") || "1080";
    const tmpDir = await mkdtemp(join(tmpdir(), "ytstream-"));
    ticket.tmpDir = tmpDir;
    const videoFifo = join(tmpDir, "video.fifo");
    const audioFifo = join(tmpDir, "audio.fifo");
    await execFileAsync("mkfifo", [videoFifo]);
    await execFileAsync("mkfifo", [audioFifo]);

    const videoProc = spawnYtdlToFifo(
      ytdlBin(),
      ["--no-playlist", ...progressArgs(), ...cookieArgs(), "-f", `bv*[height<=${height}]`],
      ticket.input.url,
      videoFifo,
    );
    const audioProc = spawnYtdlToFifo(
      ytdlBin(),
      ["--no-playlist", ...progressArgs(), ...cookieArgs(), "-f", "ba"],
      ticket.input.url,
      audioFifo,
    );
    ticket.processes.push(videoProc, audioProc);

    const progress: { video: ProgressUpdate; audio: ProgressUpdate } = { video: {}, audio: {} };
    videoProc.onLine((line) => {
      const p = parseProgressLine(line);
      if (p) {
        progress.video = p;
        this.reportCombinedProgress(ticket, progress);
      }
    });
    audioProc.onLine((line) => {
      const p = parseProgressLine(line);
      if (p) {
        progress.audio = p;
        this.reportCombinedProgress(ticket, progress);
      }
    });

    // UWAGA: nie da się tu czekać, aż yt-dlp "zacznie pisać" przed
    // odpaleniem ffmpeg — to byłby zakleszczenie. `cat` (pisarz FIFO, patrz
    // spawnYtdlToFifo) blokuje się w open() dopóki ffmpeg nie otworzy FIFO
    // do czytania jako pierwszy; żadna linia postępu nie pojawi się, zanim
    // ffmpeg w ogóle wystartuje.
    // `-thread_queue_size` dla każdego `-i` to standardowy, tani bufor na
    // czas analizy pierwszego wejścia — zostawiony jako dodatkowy zapas,
    // choć rzeczywisty root cause sporadycznego "Invalid data found" był
    // gdzie indziej (patrz obszerny komentarz przy `spawnYtdlToFifo` w
    // ytdlp.ts: wewnętrzna logika otwierania plików w samym yt-dlp ścigała
    // się z otwarciem FIFO przez ffmpeg).
    const ffmpeg = spawn(
      ffmpegBin(),
      [
        "-hide_banner",
        "-thread_queue_size",
        "4096",
        "-i",
        videoFifo,
        "-thread_queue_size",
        "4096",
        "-i",
        audioFifo,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c",
        "copy",
        "-f",
        "mp4",
        "-movflags",
        "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    ticket.processes.push({ kill: () => ffmpeg.kill("SIGTERM") });
    return ffmpeg;
  }

  /**
   * Zamienia stdout ffmpeg (finalnego producenta bajtów, dla mp3 i mp4) na
   * `ReadableStream` do `Response`. Krótkie okno startowe: jeśli ffmpeg padnie
   * zanim wypłynie pierwszy bajt, `consume()` dostaje odrzucony `ready` i może
   * zwrócić JSON błędu zamiast 200 z uciętym plikiem; po tym oknie ryzyko
   * ucięcia w trakcie jest akceptowane (SSE i tak pokazuje błąd w UI).
   */
  private streamFromFfmpeg(
    ticket: InternalTicket,
    ffmpeg: ChildProcess,
  ): Promise<ReadableStream<Uint8Array>> {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;
    let resolveReady!: (stream: ReadableStream<Uint8Array>) => void;
    let rejectReady!: (error: unknown) => void;
    let stderrTail = "";

    const readyPromise = new Promise<ReadableStream<Uint8Array>>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
      },
      cancel: () => {
        ticket.canceled = true;
        void this.teardown(ticket);
      },
    });

    const settleOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveReady(stream);
    };
    const settleFail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectReady(error);
    };

    // Patrz komentarz w spawnAudioPipeline — 'error' bez handlera na strumieniu
    // zabija cały proces workera, nie tylko ten transfer.
    ffmpeg.stdout!.on("error", () => undefined);
    ffmpeg.stderr!.on("error", () => undefined);

    ffmpeg.stdout!.on("data", (chunk: Buffer) => {
      try {
        controllerRef?.enqueue(new Uint8Array(chunk));
      } catch {
        // kontroler już zamknięty (klient rozłączony)
      }
      settleOk();
    });
    ffmpeg.stdout!.on("end", () => {
      try {
        controllerRef?.close();
      } catch {
        // już zamknięty
      }
      if (!ticket.canceled) {
        this.finish(ticket, { ...ticket.dto, status: "done", progress: 100 });
      }
      void this.teardown(ticket);
    });
    ffmpeg.stderr!.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-8000);
    });
    ffmpeg.once("error", (error) => {
      settleFail(error);
      try {
        controllerRef?.error(error);
      } catch {
        // już zamknięty
      }
    });
    ffmpeg.once("close", (code) => {
      if (code !== 0 && !ticket.canceled) {
        const error = new Error(stderrTail || `ffmpeg exited with ${code}`);
        settleFail(error);
        try {
          controllerRef?.error(error);
        } catch {
          // już zamknięty
        }
        if (!settled) {
          // (nieosiągalne po settleFail, ale dla jasności: błąd po starcie
          // strumienia jest już tylko widoczny jako ucięty plik + SSE error)
        }
      }
    });

    // Krótkie okno na szybkie błędy (video niedostępne, geoblok, wiek) —
    // typowo failują w 1-3 s. Po tym czasie zakładamy, że wolny start
    // (np. ekstrakcja sygnatur) jest w porządku i oddajemy strumień.
    const timer = setTimeout(settleOk, 6000);

    return readyPromise;
  }

  private reportProgress(ticket: InternalTicket, p: ProgressUpdate): void {
    const computed =
      p.totalBytes && p.totalBytes > 0 && p.downloadedBytes != null
        ? Math.min(100, (p.downloadedBytes / p.totalBytes) * 100)
        : ticket.dto.progress;
    this.emit(ticket, {
      ...ticket.dto,
      status: "downloading",
      progress: Number.isFinite(computed) ? computed : ticket.dto.progress,
      downloadedBytes: p.downloadedBytes,
      totalBytes: p.totalBytes,
      speedBytesPerSec: p.speedBytesPerSec,
      etaSec: p.etaSec,
    });
  }

  private reportCombinedProgress(
    ticket: InternalTicket,
    progress: { video: ProgressUpdate; audio: ProgressUpdate },
  ): void {
    const downloaded =
      (progress.video.downloadedBytes ?? 0) + (progress.audio.downloadedBytes ?? 0);
    const total = (progress.video.totalBytes ?? 0) + (progress.audio.totalBytes ?? 0);
    const speed = (progress.video.speedBytesPerSec ?? 0) + (progress.audio.speedBytesPerSec ?? 0);
    const eta = Math.max(progress.video.etaSec ?? 0, progress.audio.etaSec ?? 0);
    const computed = total > 0 ? Math.min(100, (downloaded / total) * 100) : ticket.dto.progress;
    this.emit(ticket, {
      ...ticket.dto,
      status: "downloading",
      progress: Number.isFinite(computed) ? computed : ticket.dto.progress,
      downloadedBytes: downloaded || undefined,
      totalBytes: total || undefined,
      speedBytesPerSec: speed || undefined,
      etaSec: eta || undefined,
    });
  }

  private async teardown(ticket: InternalTicket): Promise<void> {
    for (const p of ticket.processes) {
      try {
        p.kill();
      } catch {
        // proces mógł już zakończyć działanie
      }
    }
    if (ticket.tmpDir) {
      const dir = ticket.tmpDir;
      ticket.tmpDir = undefined;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [id, ticket] of this.tickets) {
      if (!ticket.consumed && now > ticket.expiresAt) {
        this.tickets.delete(id);
      } else if (ticket.consumed && TERMINAL.includes(ticket.dto.status)) {
        this.tickets.delete(id);
      }
    }
  }

  // --- emisje z throttlingiem (≤4/s, kontrakt §0.6) -------------------------

  private finish(ticket: InternalTicket, dto: StreamDto): void {
    ticket.dto = dto;
    if (dto.status === "error") {
      console.error(
        `[worker] stream ${dto.id} failed (${dto.errorCode ?? "UNKNOWN"}): ${dto.error ?? ""}`,
      );
    }
    this.emit(ticket, dto, true);
  }

  private emit(ticket: InternalTicket, dto: StreamDto, immediate = false): void {
    ticket.dto = dto;
    const now = Date.now();
    const statusChanged = ticket.pendingDto === null || ticket.pendingDto.status !== dto.status;
    const due = immediate || now - ticket.lastEmitAt >= EMIT_INTERVAL_MS;

    if (due) {
      if (ticket.pendingTimer) {
        clearTimeout(ticket.pendingTimer);
        ticket.pendingTimer = null;
        ticket.pendingDto = null;
      }
      ticket.lastEmitAt = now;
      this.broadcast(dto);
      return;
    }

    ticket.pendingDto = dto;
    if (!ticket.pendingTimer) {
      ticket.pendingTimer = setTimeout(
        () => {
          ticket.pendingTimer = null;
          const pending = ticket.pendingDto;
          ticket.pendingDto = null;
          if (pending) {
            ticket.lastEmitAt = Date.now();
            this.broadcast(pending);
          }
        },
        EMIT_INTERVAL_MS - (now - ticket.lastEmitAt),
      );
      if (statusChanged) {
        clearTimeout(ticket.pendingTimer);
        ticket.pendingTimer = null;
        ticket.pendingDto = null;
        ticket.lastEmitAt = now;
        this.broadcast(dto);
      }
    }
  }

  private broadcast(dto: StreamDto): void {
    const set = this.subscribers.get(dto.id);
    if (!set) return;
    for (const cb of set) {
      try {
        cb(dto);
      } catch {
        // błąd subskrybenta nie może zabić workera
      }
    }
  }
}
