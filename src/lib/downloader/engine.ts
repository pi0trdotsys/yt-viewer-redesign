import type { DownloadJob } from "@/components/downloader/types";

import { jobDtoSchema, jobListDtoSchema, type JobDto, type StartInput } from "./types.shared";

/**
 * Klient silnika pobierania (kontrakt §4).
 *
 * Transport: gateway `/api/public/*` (same-origin; Basic Auth dołącza
 * przeglądarka). Postęp: SSE per aktywny job (backoff 1s→2s→5s→10s, maks. 5
 * prób — kontrakt §9), z fallbackiem pollingu `list()` co 4 s, który pokrywa
 * też joby z playlisty i stan po restarcie workera.
 */

const TERMINAL_STATUSES = new Set(["done", "error", "canceled"]);
const SSE_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];
const POLL_INTERVAL_MS = 4000;

/** Mapowanie kod → komunikat PL (kontrakt §8 — jedno miejsce po stronie klienta). */
const ERROR_MESSAGES: Record<string, string> = {
  GEO: "Film niedostępny w Twoim regionie",
  PRIVATE: "Wymagane logowanie (wideo prywatne)",
  NOT_FOUND: "Nie znaleziono filmu pod tym adresem",
  DISK: "Brak miejsca na dysku",
  NETWORK: "Przerwane połączenie — spróbuj ponownie",
  AGE: "Film z ograniczeniem wiekowym",
  UNKNOWN: "Nie udało się pobrać pliku",
};

function isTerminal(status: JobDto["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

function toUiJob(dto: JobDto): DownloadJob {
  return {
    id: dto.id,
    url: dto.url,
    title: dto.title,
    thumbnailUrl: dto.thumbnailUrl,
    durationSec: dto.durationSec,
    format: dto.format,
    quality: dto.quality,
    status: dto.status,
    progress: dto.progress,
    speedBytesPerSec: dto.speedBytesPerSec,
    etaSec: dto.etaSec,
    downloadedBytes: dto.downloadedBytes,
    totalBytes: dto.totalBytes,
    outputPath: dto.outputPath,
    error: dto.errorCode ? (ERROR_MESSAGES[dto.errorCode] ?? dto.error) : dto.error,
  };
}

async function readError(res: Response): Promise<Error> {
  try {
    const payload = (await res.json()) as { error?: unknown };
    if (typeof payload.error === "string") {
      return new Error(`${res.status}: ${payload.error}`);
    }
  } catch {
    // body nie jest JSON-em — poniżej generyczny komunikat
  }
  return new Error(`Żądanie nie powiodło się (${res.status})`);
}

export class HttpDownloaderEngine {
  private dtos = new Map<string, JobDto>();
  private listeners = new Set<(job: DownloadJob) => void>();
  private sources = new Map<string, EventSource>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sseFailures = new Map<string, number>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  // --- kontrakt: start/cancel/retry/list/subscribe -------------------------

  async start(input: StartInput): Promise<string> {
    const res = await fetch("/api/public/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res);
    const data = jobListDtoSchema.parse(await res.json());
    const first = data.jobs[0];
    if (!first) throw new Error("Worker nie utworzył zadania");
    for (const dto of data.jobs) this.emit(dto);
    this.refreshStreams();
    this.ensurePolling();
    return first.id;
  }

  async cancel(jobId: string): Promise<void> {
    // Optymistycznie: UI natychmiast pokazuje "Anulowano"; serwer potwierdzi.
    const dto = this.dtos.get(jobId);
    if (dto && !isTerminal(dto.status)) {
      this.emit({ ...dto, status: "canceled" });
    }
    try {
      await fetch(`/api/public/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    } catch {
      // polling/SSE doprecyzuje stan
    }
  }

  async retry(jobId: string): Promise<string> {
    const res = await fetch(`/api/public/jobs/${encodeURIComponent(jobId)}/retry`, {
      method: "POST",
    });
    if (!res.ok) throw await readError(res);
    const data = jobListDtoSchema.parse(await res.json());
    const first = data.jobs[0];
    if (!first) throw new Error("Nie udało się ponowić zadania");
    for (const dto of data.jobs) this.emit(dto);
    this.ensurePolling();
    return first.id;
  }

  async list(): Promise<DownloadJob[]> {
    const res = await fetch("/api/public/jobs");
    if (!res.ok) throw await readError(res);
    const data = jobListDtoSchema.parse(await res.json());
    return data.jobs.map(toUiJob);
  }

  subscribe(cb: (job: DownloadJob) => void): () => void {
    this.listeners.add(cb);
    // Natychmiastowa reprodukcja znanego stanu.
    for (const dto of this.dtos.values()) cb(toUiJob(dto));
    this.refreshStreams();
    this.ensurePolling();

    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        // Kontrakt §4: brak subskrybentów → zamykamy transport.
        this.teardownTransports();
      }
    };
  }

  // --- rozszerzenia poza interfejs kontraktu (persystencja / pobieranie) ---

  /** Aktualny, lokalnie znany stan wszystkich jobów (UI). */
  snapshot(): DownloadJob[] {
    return [...this.dtos.values()].map(toUiJob);
  }

  /** URL pobierania pliku dla ukończonego joba (z tokenem) albo null. */
  getDownloadUrl(jobId: string): string | null {
    const dto = this.dtos.get(jobId);
    if (!dto || dto.status !== "done" || !dto.hasFile || !dto.streamToken) return null;
    return `/api/public/files/${encodeURIComponent(dto.id)}?token=${encodeURIComponent(dto.streamToken)}`;
  }

  /** DTO do persystencji w localStorage (zawiera streamToken). */
  exportDtos(): JobDto[] {
    return [...this.dtos.values()];
  }

  /**
   * Przywraca DTO z localStorage. Rekordy niezgodne ze schematem są odrzucane
   * (§10); joby nieterminalne oznaczane jako `canceled`, chyba że serwer
   * potwierdzi ich życie w `syncFromServer()`.
   */
  importDtos(dtos: unknown): void {
    if (!Array.isArray(dtos)) return;
    for (const candidate of dtos) {
      const parsed = jobDtoSchema.safeParse(candidate);
      if (!parsed.success) continue;
      const dto = parsed.data;
      this.emit(isTerminal(dto.status) ? dto : { ...dto, status: "canceled" as const });
    }
  }

  /** Usuwa z pamięci joby terminalne (czyszczenie historii). */
  clearFinished(): void {
    for (const [id, dto] of this.dtos) {
      if (isTerminal(dto.status)) this.dtos.delete(id);
    }
  }

  /** Synchronizacja z serwerem — źródło prawdy po restarcie / dla playlist. */
  async syncFromServer(): Promise<void> {
    let data;
    try {
      const res = await fetch("/api/public/jobs");
      if (!res.ok) return;
      data = jobListDtoSchema.parse(await res.json());
    } catch {
      return; // worker chwilowo niedostępny — spróbujemy przy następnym ticku
    }
    const serverIds = new Set<string>();
    for (const dto of data.jobs) {
      serverIds.add(dto.id);
      this.emit(dto);
    }
    for (const local of [...this.dtos.values()]) {
      if (!serverIds.has(local.id) && !isTerminal(local.status)) {
        this.emit({ ...local, status: "canceled" as const });
      }
    }
    this.refreshStreams();
  }

  // --- wewnętrzne -----------------------------------------------------------

  private emit(dto: JobDto): void {
    this.dtos.set(dto.id, dto);
    const ui = toUiJob(dto);
    for (const listener of this.listeners) {
      try {
        listener(ui);
      } catch (error) {
        console.error("[engine] listener error:", error);
      }
    }
  }

  private ensurePolling(): void {
    if (this.polling || this.listeners.size === 0) return;
    this.polling = true;
    const tick = async (): Promise<void> => {
      const hasActive = [...this.dtos.values()].some((d) => !isTerminal(d.status));
      if (!hasActive) {
        this.stopPolling();
        return;
      }
      await this.syncFromServer();
    };
    this.pollTimer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.polling = false;
  }

  private refreshStreams(): void {
    for (const dto of this.dtos.values()) {
      if (isTerminal(dto.status)) {
        this.closeStream(dto.id);
        continue;
      }
      if (!dto.streamToken || this.sources.has(dto.id)) continue;
      this.openStream(dto.id, dto.streamToken);
    }
  }

  private openStream(jobId: string, token: string): void {
    const source = new EventSource(
      `/api/public/progress/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`,
    );

    source.addEventListener("job", (event) => {
      try {
        const dto = jobDtoSchema.parse(JSON.parse((event as MessageEvent<string>).data));
        this.sseFailures.set(jobId, 0);
        this.emit(dto);
        if (isTerminal(dto.status)) {
          source.close();
          this.sources.delete(jobId);
        }
      } catch {
        // niepoprawna ramka — ignoruj, kolejne przyjdą
      }
    });

    source.onerror = () => {
      source.close();
      this.sources.delete(jobId);
      const attempts = (this.sseFailures.get(jobId) ?? 0) + 1;
      this.sseFailures.set(jobId, attempts);
      if (attempts > SSE_RECONNECT_DELAYS_MS.length) {
        // Kontrakt §9: po wyczerpaniu prób — pozostaje polling.
        return;
      }
      const delay =
        SSE_RECONNECT_DELAYS_MS[Math.min(attempts - 1, SSE_RECONNECT_DELAYS_MS.length - 1)]!;
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(jobId);
        const dto = this.dtos.get(jobId);
        if (dto && !isTerminal(dto.status) && this.listeners.size > 0 && dto.streamToken) {
          this.openStream(jobId, dto.streamToken);
        }
      }, delay);
      this.reconnectTimers.set(jobId, timer);
    };

    this.sources.set(jobId, source);
  }

  private closeStream(jobId: string): void {
    const source = this.sources.get(jobId);
    if (source) {
      source.close();
      this.sources.delete(jobId);
    }
    const timer = this.reconnectTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(jobId);
    }
  }

  private teardownTransports(): void {
    for (const id of [...this.sources.keys()]) this.closeStream(id);
    this.stopPolling();
  }
}

let engineInstance: HttpDownloaderEngine | undefined;

/** Singleton — używać wyłącznie po stronie klienta. */
export function getDownloaderEngine(): HttpDownloaderEngine {
  if (!engineInstance) engineInstance = new HttpDownloaderEngine();
  return engineInstance;
}
