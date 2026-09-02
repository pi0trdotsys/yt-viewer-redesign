import { randomUUID } from "node:crypto";
import { readdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import {
  buildDownloadArgs,
  classifyError,
  downloadDir,
  isPostprocessLine,
  maxDurationSec,
  parseProgressLine,
  probe,
  spawnYtdl,
  type JobErrorCode,
  type SpawnedProcess,
} from "./ytdlp";

/**
 * Menedżer jobów: maszyna stanów (kontrakt §5), throttling emisji ≤4/s (§0.6),
 * kolejka z limitem równoległości, hub SSE, czyszczenie plików częściowych.
 * Stan wyłącznie w pamięci — klient utrzymuje historię w localStorage (§10).
 */

export type JobStatus =
  "idle" | "resolving" | "downloading" | "converting" | "done" | "error" | "canceled";

export interface JobDto {
  id: string;
  url: string;
  title?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  format: "mp3" | "mp4";
  quality: string;
  status: JobStatus;
  progress: number;
  speedBytesPerSec?: number;
  etaSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  outputPath?: string;
  error?: string;
  errorCode?: JobErrorCode;
  streamToken?: string;
  hasFile?: boolean;
}

export const QUALITY_OPTIONS: Record<JobDto["format"], string[]> = {
  mp3: ["128kbps", "192kbps", "320kbps"],
  mp4: ["480p", "720p", "1080p", "1440p", "2160p"],
};

const TERMINAL: JobStatus[] = ["done", "error", "canceled"];
const EMIT_INTERVAL_MS = 250; // ≤4 emisje/s (kontrakt §0.6)
const MAX_TERMINAL_JOBS = 200;

interface InternalJob {
  dto: JobDto;
  input: { url: string; format: "mp3" | "mp4"; quality: string };
  /** Kto utworzył zadanie (z nagłówka X-User-Id, ustawianego przez gateway po
   *  weryfikacji sesji) — izoluje kolejkę/historię między kontami. */
  ownerId: string;
  process?: SpawnedProcess;
  canceled: boolean;
  lastEmitAt: number;
  pendingTimer: ReturnType<typeof setTimeout> | null;
  pendingDto: JobDto | null;
  /** Kiedy zadanie weszło w stan terminalny — do TTL nieodebranych plików. */
  finishedAt?: number;
}

export class JobManager {
  private jobs = new Map<string, InternalJob>();
  private queue: string[] = [];
  private subscribers = new Map<string, Set<(dto: JobDto) => void>>();
  private secret: string;
  private maxConcurrent: number;
  private maxPlaylistItems: number;
  private fileTtlMs: number;

  constructor(secret: string) {
    this.secret = secret;
    const concurrent = Number(process.env["MAX_CONCURRENT_JOBS"] ?? "2");
    this.maxConcurrent = Number.isFinite(concurrent) && concurrent > 0 ? concurrent : 2;
    const playlist = Number(process.env["MAX_PLAYLIST_ITEMS"] ?? "25");
    this.maxPlaylistItems = Number.isFinite(playlist) && playlist > 0 ? playlist : 25;
    const ttlSec = Number(process.env["FILE_TTL_SEC"] ?? "1800");
    this.fileTtlMs = (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 1800) * 1000;

    // Siatka bezpieczeństwa: appka nie ma pełnić roli trwałego magazynu —
    // plik dostarczony do przeglądarki jest kasowany od razu (patrz
    // deleteJobFiles() wołane z fileResponse w index.ts), a to tylko
    // sprząta pliki nigdy nieodebrane przez użytkownika.
    setInterval(() => void this.sweepExpiredFiles(), 5 * 60 * 1000).unref();
  }

  // --- API ------------------------------------------------------------------

  create(
    input: { url: string; format: "mp3" | "mp4"; quality: string },
    ownerId: string,
  ): JobDto[] {
    const activeCount = [...this.jobs.values()].filter(
      (job) => !TERMINAL.includes(job.dto.status),
    ).length;
    if (activeCount >= 50) {
      throw Object.assign(new Error("Za dużo aktywnych zadań — spróbuj za chwilę"), {
        statusCode: 429,
      });
    }

    const job = this.newJob(input, ownerId);
    this.jobs.set(job.dto.id, job);
    this.queue.push(job.dto.id);
    this.pump();
    this.pruneTerminal();
    return [job.dto];
  }

  /** Anulowanie jest no-opem dla nieistniejącego/cudzego joba — nie zdradzamy
   *  czy w ogóle istnieje (izolacja per-user). */
  cancel(jobId: string, ownerId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId || TERMINAL.includes(job.dto.status)) return; // idempotentne (§4)
    job.canceled = true;
    if (job.process) {
      job.process.kill();
    } else {
      this.queue = this.queue.filter((id) => id !== jobId);
      this.finish(job, { ...job.dto, status: "canceled" });
    }
  }

  retry(jobId: string, ownerId: string): JobDto[] {
    const job = this.jobs.get(jobId);
    if (!job || job.ownerId !== ownerId) {
      throw Object.assign(new Error("Nie znaleziono zadania"), { statusCode: 404 });
    }
    if (job.dto.status !== "error" && job.dto.status !== "canceled") {
      throw Object.assign(new Error("Ponowić można wyłącznie zadania zakończone błędem"), {
        statusCode: 409,
      });
    }
    return this.create(job.input, ownerId);
  }

  list(ownerId: string): JobDto[] {
    return [...this.jobs.values()].filter((job) => job.ownerId === ownerId).map((job) => job.dto);
  }

  get(jobId: string, ownerId: string): JobDto | undefined {
    const job = this.jobs.get(jobId);
    return job && job.ownerId === ownerId ? job.dto : undefined;
  }

  subscribe(jobId: string, cb: (dto: JobDto) => void): () => void {
    let set = this.subscribers.get(jobId);
    if (!set) {
      set = new Set();
      this.subscribers.set(jobId, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
      if (set!.size === 0) this.subscribers.delete(jobId);
    };
  }

  /** Ścieżka pliku wynikowego (jeśli istnieje na dysku). */
  async resolveFilePath(jobId: string): Promise<string | null> {
    const job = this.jobs.get(jobId);
    if (!job || job.dto.status !== "done" || !job.dto.outputPath) return null;
    const path = join(downloadDir(), job.dto.outputPath);
    try {
      const info = await stat(path);
      return info.isFile() ? path : null;
    } catch {
      return null;
    }
  }

  // --- maszyna stanów -------------------------------------------------------

  private newJob(
    input: { url: string; format: "mp3" | "mp4"; quality: string },
    ownerId: string,
  ): InternalJob {
    const dto: JobDto = {
      id: randomUUID(),
      url: input.url,
      format: input.format,
      quality: input.quality,
      status: "idle",
      progress: 0,
    };
    return {
      dto,
      input,
      ownerId,
      canceled: false,
      lastEmitAt: 0,
      pendingTimer: null,
      pendingDto: null,
    };
  }

  private pump(): void {
    const running = [...this.jobs.values()].filter(
      (job) =>
        job.dto.status === "resolving" ||
        job.dto.status === "downloading" ||
        job.dto.status === "converting",
    ).length;
    let slots = this.maxConcurrent - running;
    while (slots > 0 && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const job = this.jobs.get(id);
      if (!job || TERMINAL.includes(job.dto.status)) continue;
      void this.run(job);
      slots -= 1;
    }
  }

  private async run(job: InternalJob): Promise<void> {
    try {
      await this.resolvePhase(job);
      if (job.canceled) return;
      await this.downloadPhase(job);
    } catch (error) {
      if (job.canceled) return;
      const message = error instanceof Error ? error.message : String(error);
      const code = classifyError(message);
      this.finish(job, {
        ...job.dto,
        status: "error",
        errorCode: code,
        error: message.slice(0, 512),
      });
    } finally {
      this.pump();
    }
  }

  private async resolvePhase(job: InternalJob): Promise<void> {
    this.emit({ ...job.dto, status: "resolving", progress: 0 });
    const metadata = await probe(job.input.url);

    if (metadata.isPlaylist) {
      // Playlista: parent przejmuje pierwszy element, reszta trafia do kolejki.
      const limit = this.maxPlaylistItems;
      const entries = metadata.entries.slice(0, limit);
      if (entries.length === 0) {
        throw new Error("Playlista jest pusta lub niedostępna");
      }
      for (const entryUrl of entries.slice(1)) {
        const child = this.newJob({ ...job.input, url: entryUrl }, job.ownerId);
        this.jobs.set(child.dto.id, child);
        this.queue.push(child.dto.id);
        this.emit(child.dto);
      }
      job.input = { ...job.input, url: entries[0]! };
      job.dto = { ...job.dto, url: entries[0]! };
      const first = await probe(entries[0]!);
      this.applyMetadata(job, first);
      return;
    }

    if (metadata.durationSec && metadata.durationSec > maxDurationSec()) {
      throw new Error(`Film przekracza limit długości (${maxDurationSec()} s)`);
    }
    this.applyMetadata(job, metadata);
  }

  private applyMetadata(
    job: InternalJob,
    metadata: { title?: string; durationSec?: number; thumbnailUrl?: string },
  ): void {
    job.dto = {
      ...job.dto,
      title: metadata.title,
      durationSec: metadata.durationSec,
      thumbnailUrl: metadata.thumbnailUrl,
    };
  }

  private async downloadPhase(job: InternalJob): Promise<void> {
    const args = buildDownloadArgs(job.dto.id, job.input.format, job.input.quality);
    args.push("--", job.input.url);
    const child = spawnYtdl(args);
    job.process = child;
    this.emit({ ...job.dto, status: "downloading" });

    let convertingAnnounced = false;

    child.onLine((line) => {
      if (job.canceled) return;
      const progress = parseProgressLine(line);
      if (progress) {
        const total = progress.totalBytes ?? job.dto.totalBytes;
        const downloaded = progress.downloadedBytes ?? job.dto.downloadedBytes;
        const computed =
          total && total > 0 && downloaded != null
            ? Math.min(100, (downloaded / total) * 100)
            : job.dto.progress;
        this.emit({
          ...job.dto,
          status: "downloading",
          progress: Number.isFinite(computed) ? computed : job.dto.progress,
          downloadedBytes: downloaded,
          totalBytes: total,
          speedBytesPerSec: progress.speedBytesPerSec,
          etaSec: progress.etaSec,
        });
        return;
      }
      if (!convertingAnnounced && isPostprocessLine(line)) {
        convertingAnnounced = true;
        this.emit({ ...job.dto, status: "converting", progress: 0 });
      }
    });

    const code = await child.exited;
    job.process = undefined;
    if (job.canceled) return;

    if (code !== 0) {
      const code2 = classifyError(child.stderrTail());
      this.finish(job, {
        ...job.dto,
        status: "error",
        errorCode: code2,
        error: child.stderrTail().split("\n").slice(-3).join(" ").slice(0, 512),
      });
      await this.cleanupFiles(job.dto.id);
      return;
    }

    const file = await this.findOutputFile(job.dto.id);
    if (!file) {
      this.finish(job, {
        ...job.dto,
        status: "error",
        errorCode: "UNKNOWN",
        error: "Nie znaleziono pliku wynikowego",
      });
      return;
    }

    this.finish(job, {
      ...job.dto,
      status: "done",
      progress: 100,
      outputPath: file,
      hasFile: true,
      speedBytesPerSec: undefined,
      etaSec: undefined,
    });
  }

  private async findOutputFile(jobId: string): Promise<string | null> {
    try {
      const entries = await readdir(downloadDir());
      const candidates = entries.filter(
        (name: string) =>
          name.startsWith(`${jobId}.`) && !name.endsWith(".part") && !name.endsWith(".ytdl"),
      );
      if (candidates.length === 0) return null;
      const preferred =
        candidates.find((name: string) => name.endsWith(".mp4")) ??
        candidates.find((name: string) => name.endsWith(".mp3")) ??
        candidates[0]!;
      return preferred;
    } catch {
      return null;
    }
  }

  private async cleanupFiles(jobId: string): Promise<void> {
    try {
      const entries = await readdir(downloadDir());
      for (const name of entries) {
        if (name.startsWith(jobId)) {
          await unlink(join(downloadDir(), name)).catch(() => undefined);
        }
      }
    } catch {
      // katalog może nie istnieć — ignoruj
    }
  }

  /**
   * Kasuje plik wynikowy joba z dysku — wołane z `fileResponse()` w
   * index.ts zaraz po pełnym wysłaniu pliku do przeglądarki (albo przy
   * przerwaniu transferu przez klienta), oraz przez `sweepExpiredFiles()`
   * dla plików nigdy nieodebranych. Appka nie ma pełnić roli trwałego
   * magazynu plików.
   */
  async deleteJobFiles(jobId: string): Promise<void> {
    await this.cleanupFiles(jobId);
    const job = this.jobs.get(jobId);
    if (job?.dto.hasFile) {
      job.dto = { ...job.dto, hasFile: false };
    }
  }

  /** TTL dla plików, których nikt nie odebrał (§ konstruktor). */
  private async sweepExpiredFiles(): Promise<void> {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      if (job.dto.status !== "done" || !job.dto.hasFile || !job.finishedAt) continue;
      if (now - job.finishedAt < this.fileTtlMs) continue;
      await this.deleteJobFiles(job.dto.id);
    }
  }

  // --- emisje z throttlingiem ----------------------------------------------

  private finish(job: InternalJob, dto: JobDto): void {
    job.dto = dto;
    if (TERMINAL.includes(dto.status)) job.finishedAt = Date.now();
    if (dto.status === "error") {
      // Jedyny ślad błędu w `docker compose logs worker` — bez tego
      // nieudane pobrania są widoczne tylko w UI, nie w logach kontenera.
      console.error(
        `[worker] job ${dto.id} failed (${dto.errorCode ?? "UNKNOWN"}) url=${dto.url}: ${dto.error ?? ""}`,
      );
    }
    this.emit(dto, true); // terminalne zawsze natychmiast (§4)
  }

  private emit(dto: JobDto, immediate = false): void {
    const job = this.jobs.get(dto.id);
    if (!job) return;
    job.dto = dto;

    const now = Date.now();
    const statusChanged = job.pendingDto === null || job.pendingDto.status !== dto.status;
    const due = immediate || now - job.lastEmitAt >= EMIT_INTERVAL_MS;

    if (due) {
      if (job.pendingTimer) {
        clearTimeout(job.pendingTimer);
        job.pendingTimer = null;
        job.pendingDto = null;
      }
      job.lastEmitAt = now;
      this.broadcast(dto);
      return;
    }

    // Zaplanuj emisję końcową (trailing), aby nie gubić ostatniej wartości.
    job.pendingDto = dto;
    if (!job.pendingTimer) {
      job.pendingTimer = setTimeout(
        () => {
          job.pendingTimer = null;
          const pending = job.pendingDto;
          job.pendingDto = null;
          if (pending) {
            job.lastEmitAt = Date.now();
            this.broadcast(pending);
          }
        },
        EMIT_INTERVAL_MS - (now - job.lastEmitAt),
      );
      if (statusChanged) {
        // zmiana statusu zawsze emitowana natychmiast (§4)
        clearTimeout(job.pendingTimer);
        job.pendingTimer = null;
        job.pendingDto = null;
        job.lastEmitAt = now;
        this.broadcast(dto);
      }
    }
  }

  private broadcast(dto: JobDto): void {
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

  private pruneTerminal(): void {
    const terminal = [...this.jobs.values()].filter((job) => TERMINAL.includes(job.dto.status));
    if (terminal.length <= MAX_TERMINAL_JOBS) return;
    for (const job of terminal.slice(0, terminal.length - MAX_TERMINAL_JOBS)) {
      this.jobs.delete(job.dto.id);
    }
  }
}
