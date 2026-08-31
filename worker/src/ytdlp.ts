import { spawn } from "node:child_process";

/**
 * Integracja z yt-dlp: budowanie argumentów, parsowanie postępu
 * (--progress-template + --newline), klasyfikacja błędów na kody DTO
 * (kontrakt §8). yt-dlp/ffmpeg uruchamiane są wyłącznie tutaj — worker
 * jest osobną usługą (Model A), nie warstwą serwerową aplikacji.
 */

export type JobErrorCode = "GEO" | "PRIVATE" | "NOT_FOUND" | "DISK" | "NETWORK" | "AGE" | "UNKNOWN";

export interface YtdlMetadata {
  title?: string;
  durationSec?: number;
  thumbnailUrl?: string;
  isPlaylist: boolean;
  entries: string[]; // URL-e wideo (playlista)
}

/** Prefiks linii postępu z --progress-template. */
export const PROGRESS_PREFIX = "YTDLPROG|";

export function ytdlBin(): string {
  return process.env["YT_DLP_BIN"] ?? "yt-dlp";
}

export function downloadDir(): string {
  return process.env["DOWNLOAD_DIR"] ?? "/data";
}

export function maxDurationSec(): number {
  const raw = Number(process.env["MAX_DURATION_SEC"] ?? "21600");
  return Number.isFinite(raw) && raw > 0 ? raw : 21600;
}

/** Faza resolving: metadane pojedynczego wideo lub lista playlisty. */
export function probe(url: string): Promise<YtdlMetadata> {
  const isPlaylist = /\/playlist\?|[?&]list=/.test(url) && !/[?&]v=/.test(url);
  const args = isPlaylist
    ? ["--flat-playlist", "--dump-single-json", "--no-warnings", "--", url]
    : ["--no-playlist", "--dump-single-json", "--no-warnings", "--", url];

  return new Promise((resolve, reject) => {
    const child = spawn(ytdlBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp probe exited with ${code}`));
        return;
      }
      try {
        const json = JSON.parse(stdout) as Record<string, unknown>;
        if (isPlaylist) {
          const rawEntries = Array.isArray(json["entries"]) ? json["entries"] : [];
          const entries = rawEntries
            .map((entry) => {
              const e = entry as Record<string, unknown>;
              if (typeof e["url"] === "string" && e["url"]) return e["url"];
              if (typeof e["id"] === "string" && e["id"]) {
                return `https://www.youtube.com/watch?v=${e["id"]}`;
              }
              return "";
            })
            .filter((u) => u !== "");
          resolve({ isPlaylist: true, entries, title: asString(json["title"]) });
          return;
        }
        resolve({
          title: asString(json["title"]),
          durationSec: asNumber(json["duration"]),
          thumbnailUrl: asString(json["thumbnail"]),
          isPlaylist: false,
          entries: [],
        });
      } catch (error) {
        reject(new Error(`Nie udało się sparsować metadanych: ${String(error)}`));
      }
    });
  });
}

/** Argumenty fazy downloading dla formatu/jakości (kontrakt §7). */
export function buildDownloadArgs(jobId: string, format: string, quality: string): string[] {
  const outTemplate = `${downloadDir()}/${jobId}.%(ext)s`;
  const args = [
    "--no-playlist",
    "--newline",
    "--progress",
    "--no-colors",
    "--no-mtime",
    "--progress-template",
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
    "-o",
    outTemplate,
  ];

  if (format === "mp3") {
    const bitrate = quality.replace(/[^0-9]/g, "") || "320";
    args.push("-x", "--audio-format", "mp3", "--audio-quality", `${bitrate}K`);
    return args;
  }

  const height = quality.replace(/[^0-9]/g, "") || "1080";
  args.push(
    "-f",
    `bv*[height<=${height}]+ba/b[height<=${height}]/b`,
    "--merge-output-format",
    "mp4",
  );
  return args;
}

/** Klasyfikacja stderr yt-dlp na kod błędu DTO (kontrakt §8). */
export function classifyError(stderr: string): JobErrorCode {
  const text = stderr.toLowerCase();
  if (/sign in to confirm your age|age.restrict|inappropriate/.test(text)) return "AGE";
  if (/private video|this video is private|login required|members-only/.test(text))
    return "PRIVATE";
  if (
    /video unavailable|does not exist|has been removed|404|not found|unable to extract/.test(text)
  )
    return "NOT_FOUND";
  if (/not available in your country|geo.restrict|geo-block|blocked it in your country/.test(text))
    return "GEO";
  if (/no space left|enospc|disk quota/.test(text)) return "DISK";
  if (/timed out|timeout|connection|network|getaddrinfo|temporary failure/.test(text))
    return "NETWORK";
  return "UNKNOWN";
}

export interface ProgressUpdate {
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSec?: number;
  etaSec?: number;
}

/** Parsuje linię postępu; zwraca null dla linii nie-postępowych. */
export function parseProgressLine(line: string): ProgressUpdate | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  const parts = line.slice(PROGRESS_PREFIX.length).split("|");
  const downloaded = asNumber(parts[0]);
  const total = asNumber(parts[1]);
  const speed = asNumber(parts[2]);
  const eta = asNumber(parts[3]);
  return {
    downloadedBytes: downloaded,
    totalBytes: total,
    speedBytesPerSec: speed,
    etaSec: eta,
  };
}

/** Czy linia sygnalizuje wejście w fazę postprocessingu (konwersja/mux). */
export function isPostprocessLine(line: string): boolean {
  return /^\[(ExtractAudio|Merger|VideoRemuxer|VideoConvertor|VideoPostprocessor|EmbedThumbnail|Metadata)\]/.test(
    line,
  );
}

export interface SpawnedProcess {
  kill(): void;
  readonly exited: Promise<number>;
  onLine(cb: (line: string, stream: "out" | "err") => void): void;
  stderrTail(): string;
}

/** Uruchamia yt-dlp i strumieniowo raportuje linie stdout/stderr. */
export function spawnYtdl(args: string[]): SpawnedProcess {
  const child = spawn(ytdlBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderrTail = "";
  let exitCode: number | null = null;
  let exitResolve: ((code: number) => void) | undefined;
  const exited = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });

  const lineHandlers: Array<(line: string, stream: "out" | "err") => void> = [];

  const attach = (stream: NodeJS.ReadableStream, kind: "out" | "err") => {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      pending += chunk;
      let index = pending.indexOf("\n");
      while (index >= 0) {
        const line = pending.slice(0, index).replace(/\r$/, "");
        pending = pending.slice(index + 1);
        if (kind === "err") {
          stderrTail = (stderrTail + "\n" + line).slice(-8000);
        }
        for (const handler of lineHandlers) handler(line, kind);
        index = pending.indexOf("\n");
      }
      // yt-dlp używa \r dla postępu bez --newline; z --newline to rzadkie, ale
      // obsłużymy resztkę bufora przy zamknięciu strumienia.
      stream.on("end", () => {
        if (pending.trim() !== "") {
          if (kind === "err") stderrTail = (stderrTail + "\n" + pending).slice(-8000);
          for (const handler of lineHandlers) handler(pending, kind);
          pending = "";
        }
      });
    });
  };

  attach(child.stdout!, "out");
  attach(child.stderr!, "err");

  child.on("error", (error: unknown) => {
    stderrTail = (stderrTail + "\n" + String(error)).slice(-8000);
    exitCode = 1;
    exitResolve?.(1);
  });
  child.on("close", (code: number | null) => {
    exitCode = code ?? 1;
    exitResolve?.(exitCode);
  });

  return {
    kill() {
      if (exitCode !== null) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (exitCode === null) child.kill("SIGKILL");
      }, 5000).unref();
    },
    get exited() {
      return exited;
    },
    onLine(cb) {
      lineHandlers.push(cb);
    },
    stderrTail() {
      return stderrTail;
    },
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
