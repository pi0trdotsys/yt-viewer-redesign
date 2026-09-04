import type { DownloadJob } from "@/components/downloader/types";

import {
  createStreamResponseSchema,
  streamDtoSchema,
  type CreateStreamResponse,
  type JobErrorCode,
  type StartInput,
  type StreamDto,
} from "./types.shared";

type VideoTicket = Extract<CreateStreamResponse, { kind: "video" }>;

/**
 * Klient silnika pobierania — model "strumień + status SSE" (patrz plan,
 * decyzja usera). Zero serwerowej kolejki/joba: `POST /api/public/streams`
 * zakłada jednorazowy bilet, SSE `.../events` niesie postęp, a właściwe
 * pobranie leci wprost do przeglądarki przez ukryty `<a href="…">` — worker
 * strumieniuje bajty prosto z yt-dlp/ffmpeg, nic nie ląduje na serwerze.
 *
 * Historia/kolejka żyje wyłącznie po stronie klienta (persystencja w
 * localStorage, patrz useDownloader.ts) — nie ma czego synchronizować z
 * serwerem po restarcie karty, bilety są krótkotrwałe i jednorazowe.
 *
 * Playlisty: `POST /streams` na URL playlisty zwraca listę pozycji (same
 * URL-e, bez metadanych) zamiast biletu. Klient trzyma je jako lokalną
 * kolejkę (`queued`) i odpala właściwy `POST /streams` (świeży probe +
 * bilet) dopiero gdy przychodzi kolej danej pozycji — inaczej bilety
 * dalszych pozycji wygasałyby (TTL) zanim w ogóle by ruszyły.
 */

const TERMINAL_STATUSES = new Set<DownloadJob["status"]>(["done", "error", "canceled"]);
const SSE_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000];

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

function isTerminal(status: DownloadJob["status"]): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Stan lokalnego rekordu — nadbiór `StreamDto` o dane niesione tylko przez
 *  klienta (wejście startowe + uchwyt bieżącego biletu). */
interface LocalRecord {
  /** Stabilne id po stronie klienta — NIE id biletu (ten ostatni bywa
   *  tworzony z opóźnieniem dla pozycji playlisty, patrz `pumpQueue`). */
  id: string;
  ticketId?: string | undefined;
  token?: string | undefined;
  url: string;
  format: StartInput["format"];
  quality: string;
  status: DownloadJob["status"];
  progress: number;
  title?: string | undefined;
  durationSec?: number | undefined;
  thumbnailUrl?: string | undefined;
  speedBytesPerSec?: number | undefined;
  etaSec?: number | undefined;
  downloadedBytes?: number | undefined;
  totalBytes?: number | undefined;
  error?: string | undefined;
  errorCode?: JobErrorCode | undefined;
}

function toUiJob(record: LocalRecord): DownloadJob {
  return {
    id: record.id,
    url: record.url,
    title: record.title,
    thumbnailUrl: record.thumbnailUrl,
    durationSec: record.durationSec,
    format: record.format,
    quality: record.quality,
    status: record.status,
    progress: record.progress,
    speedBytesPerSec: record.speedBytesPerSec,
    etaSec: record.etaSec,
    downloadedBytes: record.downloadedBytes,
    totalBytes: record.totalBytes,
    error: record.errorCode ? (ERROR_MESSAGES[record.errorCode] ?? record.error) : record.error,
  };
}

function dtoPatch(dto: StreamDto): Partial<LocalRecord> {
  return {
    status: dto.status,
    progress: dto.progress,
    title: dto.title,
    durationSec: dto.durationSec,
    thumbnailUrl: dto.thumbnailUrl,
    speedBytesPerSec: dto.speedBytesPerSec,
    etaSec: dto.etaSec,
    downloadedBytes: dto.downloadedBytes,
    totalBytes: dto.totalBytes,
    error: dto.error,
    errorCode: dto.errorCode,
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

/** Zapis do localStorage — bez `ticketId`/`token`: bilety są jednorazowe i
 *  krótkotrwałe, po restarcie karty i tak nie da się ich wznowić (patrz
 *  `importDtos`), więc trzymanie ich w historii tylko niepotrzebnie
 *  wynosiłoby sekret poza pamięć procesu. */
export interface PersistedRecord {
  id: string;
  url: string;
  format: StartInput["format"];
  quality: string;
  status: DownloadJob["status"];
  progress: number;
  title?: string | undefined;
  durationSec?: number | undefined;
  thumbnailUrl?: string | undefined;
  error?: string | undefined;
  errorCode?: JobErrorCode | undefined;
}

export class HttpDownloaderEngine {
  private records = new Map<string, LocalRecord>();
  private order: string[] = [];
  private listeners = new Set<(job: DownloadJob) => void>();
  private sources = new Map<string, EventSource>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private sseFailures = new Map<string, number>();
  /** Kolejka lokalna (pozycje playlisty czekające na swój `POST /streams`). */
  private pendingQueue: string[] = [];
  /** Rekord aktualnie "aktywny" (trwa jego bilet/pobranie) — steruje pompą. */
  private activeId: string | null = null;

  // --- kontrakt: start/cancel/retry/subscribe -------------------------------

  async start(input: StartInput): Promise<void> {
    const data = await this.createStreamTicket(input);
    if (data.kind === "playlist") {
      for (const url of data.entries) {
        this.queuePlaceholder({ url, format: input.format, quality: input.quality });
      }
      return;
    }
    const record = this.recordFromTicket(crypto.randomUUID(), input, data);
    this.upsert(record);
    this.beginDownload(record);
  }

  async cancel(recordId: string): Promise<void> {
    const record = this.records.get(recordId);
    if (!record) return;
    this.pendingQueue = this.pendingQueue.filter((id) => id !== recordId);
    if (!isTerminal(record.status)) {
      this.upsert({ ...record, status: "canceled" });
    }
    this.closeStream(recordId);
    if (record.ticketId) {
      try {
        await fetch(`/api/public/streams/${encodeURIComponent(record.ticketId)}`, {
          method: "DELETE",
        });
      } catch {
        // best-effort — worker i tak posprząta po TTL/rozłączeniu
      }
    }
    if (this.activeId === recordId) {
      this.activeId = null;
      this.pumpQueue();
    }
  }

  async retry(recordId: string): Promise<void> {
    const record = this.records.get(recordId);
    if (!record) return;
    await this.start({ url: record.url, format: record.format, quality: record.quality });
  }

  subscribe(cb: (job: DownloadJob) => void): () => void {
    this.listeners.add(cb);
    for (const id of this.order) {
      const record = this.records.get(id);
      if (record) cb(toUiJob(record));
    }
    return () => {
      this.listeners.delete(cb);
    };
  }

  // --- rozszerzenia poza interfejs kontraktu (persystencja) -----------------

  snapshot(): DownloadJob[] {
    return this.order
      .map((id) => this.records.get(id))
      .filter((r): r is LocalRecord => !!r)
      .map(toUiJob);
  }

  exportDtos(): PersistedRecord[] {
    return this.order
      .map((id) => this.records.get(id))
      .filter((r): r is LocalRecord => !!r)
      .slice(-100)
      .map((r) => ({
        id: r.id,
        url: r.url,
        format: r.format,
        quality: r.quality,
        status: r.status,
        progress: r.progress,
        title: r.title,
        durationSec: r.durationSec,
        thumbnailUrl: r.thumbnailUrl,
        error: r.error,
        errorCode: r.errorCode,
      }));
  }

  /** Przywraca historię z localStorage. Zadania nieterminalne (przerwane
   *  zamknięciem karty — bilet i tak już nie do wznowienia) oznaczane jako
   *  `canceled`; podejrzane rekordy pomijane po cichu (§10). */
  importDtos(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    for (const candidate of raw as unknown[]) {
      if (!candidate || typeof candidate !== "object") continue;
      const c = candidate as Record<string, unknown>;
      if (typeof c["id"] !== "string" || typeof c["url"] !== "string") continue;
      if (c["format"] !== "mp3" && c["format"] !== "mp4") continue;
      if (typeof c["quality"] !== "string") continue;
      const status =
        typeof c["status"] === "string" ? (c["status"] as DownloadJob["status"]) : "canceled";
      const record: LocalRecord = {
        id: c["id"],
        url: c["url"],
        format: c["format"],
        quality: c["quality"],
        status: isTerminal(status) ? status : "canceled",
        progress: typeof c["progress"] === "number" ? c["progress"] : 0,
        title: typeof c["title"] === "string" ? c["title"] : undefined,
        durationSec: typeof c["durationSec"] === "number" ? c["durationSec"] : undefined,
        thumbnailUrl: typeof c["thumbnailUrl"] === "string" ? c["thumbnailUrl"] : undefined,
        error: typeof c["error"] === "string" ? c["error"] : undefined,
        errorCode:
          typeof c["errorCode"] === "string" ? (c["errorCode"] as JobErrorCode) : undefined,
      };
      this.upsertSilent(record);
    }
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const record = this.records.get(id);
      if (record && isTerminal(record.status)) {
        this.records.delete(id);
        this.order = this.order.filter((x) => x !== id);
      }
    }
  }

  // --- wewnętrzne: kolejkowanie playlist -------------------------------------

  private queuePlaceholder(input: StartInput): void {
    const record: LocalRecord = {
      id: crypto.randomUUID(),
      url: input.url,
      format: input.format,
      quality: input.quality,
      status: "queued",
      progress: 0,
    };
    this.upsert(record);
    this.pendingQueue.push(record.id);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    if (this.activeId) return;
    const nextId = this.pendingQueue.shift();
    if (!nextId) return;
    const record = this.records.get(nextId);
    if (!record) {
      this.pumpQueue();
      return;
    }
    this.activeId = nextId;
    void this.resolveAndDownload(record);
  }

  private async resolveAndDownload(record: LocalRecord): Promise<void> {
    let data;
    try {
      data = await this.createStreamTicket({
        url: record.url,
        format: record.format,
        quality: record.quality,
      });
    } catch (error) {
      this.upsert({
        ...record,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      this.activeId = null;
      this.pumpQueue();
      return;
    }
    if (data.kind === "playlist") {
      // Playlista wewnątrz pozycji playlisty nie powinna się zdarzyć —
      // traktujemy jako błąd tej pozycji, reszta kolejki jedzie dalej.
      this.upsert({ ...record, status: "error", error: "Nieobsługiwany link (playlista)" });
      this.activeId = null;
      this.pumpQueue();
      return;
    }
    const merged = this.recordFromTicket(record.id, record, data);
    this.upsert(merged);
    this.beginDownload(merged);
  }

  private beginDownload(record: LocalRecord): void {
    if (!record.ticketId || !record.token) return;
    this.activeId = record.id;
    this.openStream(record);
    this.triggerAnchorDownload(record.ticketId, record.token);
  }

  private recordFromTicket(
    id: string,
    input: Pick<StartInput, "url" | "format" | "quality">,
    data: VideoTicket,
  ): LocalRecord {
    return {
      id,
      ticketId: data.id,
      token: data.token,
      url: input.url,
      format: input.format,
      quality: input.quality,
      status: data.status,
      progress: data.progress,
      title: data.title,
      durationSec: data.durationSec,
      thumbnailUrl: data.thumbnailUrl,
    };
  }

  private async createStreamTicket(input: StartInput) {
    const res = await fetch("/api/public/streams", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw await readError(res);
    return createStreamResponseSchema.parse(await res.json());
  }

  private triggerAnchorDownload(ticketId: string, token: string): void {
    const url = `/api/public/streams/${encodeURIComponent(ticketId)}?token=${encodeURIComponent(token)}`;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.rel = "noopener";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  // --- wewnętrzne: emisje/SSE -------------------------------------------------

  private upsert(record: LocalRecord): void {
    this.upsertSilent(record);
    const ui = toUiJob(record);
    for (const listener of this.listeners) {
      try {
        listener(ui);
      } catch (error) {
        console.error("[engine] listener error:", error);
      }
    }
  }

  /** Jak `upsert`, ale bez emisji do subskrybentów — do importu historii
   *  przy hydratacji (jeszcze bez montowania odbiorców). */
  private upsertSilent(record: LocalRecord): void {
    if (!this.records.has(record.id)) this.order.push(record.id);
    this.records.set(record.id, record);
  }

  private openStream(record: LocalRecord): void {
    if (!record.ticketId || !record.token || this.sources.has(record.id)) return;
    const ticketId = record.ticketId;
    const token = record.token;
    const source = new EventSource(
      `/api/public/streams/${encodeURIComponent(ticketId)}/events?token=${encodeURIComponent(token)}`,
    );

    source.addEventListener("stream", (event) => {
      try {
        const dto = streamDtoSchema.parse(JSON.parse((event as MessageEvent<string>).data));
        this.sseFailures.set(record.id, 0);
        const current = this.records.get(record.id);
        if (!current) return;
        const merged = { ...current, ...dtoPatch(dto) };
        this.upsert(merged);
        if (TERMINAL_STATUSES.has(merged.status)) {
          this.closeStream(record.id);
          if (this.activeId === record.id) {
            this.activeId = null;
            this.pumpQueue();
          }
        }
      } catch {
        // niepoprawna ramka — ignoruj, kolejne przyjdą
      }
    });

    source.onerror = () => {
      source.close();
      this.sources.delete(record.id);
      const attempts = (this.sseFailures.get(record.id) ?? 0) + 1;
      this.sseFailures.set(record.id, attempts);
      if (attempts > SSE_RECONNECT_DELAYS_MS.length) {
        // Kontrakt §9: po wyczerpaniu prób przestajemy dobijać się o
        // postęp — sam transfer (jeśli już ruszył) leci dalej niezależnie
        // w przeglądarce, tylko UI nie dostanie już aktualizacji na żywo.
        return;
      }
      const delay =
        SSE_RECONNECT_DELAYS_MS[Math.min(attempts - 1, SSE_RECONNECT_DELAYS_MS.length - 1)]!;
      const timer = setTimeout(() => {
        this.reconnectTimers.delete(record.id);
        const current = this.records.get(record.id);
        if (current && !isTerminal(current.status) && this.listeners.size > 0) {
          this.openStream(current);
        }
      }, delay);
      this.reconnectTimers.set(record.id, timer);
    };

    this.sources.set(record.id, source);
  }

  private closeStream(recordId: string): void {
    const source = this.sources.get(recordId);
    if (source) {
      source.close();
      this.sources.delete(recordId);
    }
    const timer = this.reconnectTimers.get(recordId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(recordId);
    }
  }
}

let engineInstance: HttpDownloaderEngine | undefined;

/** Singleton — używać wyłącznie po stronie klienta. */
export function getDownloaderEngine(): HttpDownloaderEngine {
  if (!engineInstance) engineInstance = new HttpDownloaderEngine();
  return engineInstance;
}
