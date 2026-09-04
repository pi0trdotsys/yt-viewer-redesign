import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * Integracja z yt-dlp/ffmpeg: budowanie argumentów, parsowanie postępu
 * (--progress-template + --newline), klasyfikacja błędów na kody DTO.
 * yt-dlp/ffmpeg uruchamiane są wyłącznie tutaj i wyłącznie ze strumieniowaniem
 * do przeglądarki (patrz `streams.ts`) — worker nigdy nie zapisuje wynikowego
 * pliku na dysk.
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

export function ffmpegBin(): string {
  return process.env["FFMPEG_BIN"] ?? "ffmpeg";
}

export function maxDurationSec(): number {
  const raw = Number(process.env["MAX_DURATION_SEC"] ?? "21600");
  return Number.isFinite(raw) && raw > 0 ? raw : 21600;
}

/**
 * Wsparcie cookies — ten sam wzorzec co w referencyjnym Pythonowym workerze
 * (`cookies_file = "cookies.txt" if os.path.exists("cookies.txt") else None`,
 * przekazywane do `ydl_opts["cookies"]`). Pozwala ominąć "Sign in to confirm
 * you're not a bot" na hostach bez zalogowanej sesji przeglądarki.
 */
export function resolveCookiesFile(): string | null {
  const path = process.env["COOKIES_FILE"];
  if (!path) return null;
  return existsSync(path) ? path : null;
}

export function cookieArgs(): string[] {
  const path = resolveCookiesFile();
  return path ? ["--cookies", path] : [];
}

/** Wspólne flagi progresu dla wywołań pobierających (nie dla `probe`). */
export function progressArgs(): string[] {
  return [
    "--newline",
    "--progress",
    "--no-colors",
    "--no-mtime",
    "--progress-template",
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s`,
  ];
}

/** Faza resolving: metadane pojedynczego wideo lub lista playlisty. */
export function probe(url: string): Promise<YtdlMetadata> {
  const isPlaylist = /\/playlist\?|[?&]list=/.test(url) && !/[?&]v=/.test(url);
  const args = isPlaylist
    ? ["--flat-playlist", "--dump-single-json", "--no-warnings", ...cookieArgs(), "--", url]
    : ["--no-playlist", "--dump-single-json", "--no-warnings", ...cookieArgs(), "--", url];

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

/** Klasyfikacja stderr yt-dlp/ffmpeg na kod błędu DTO (kontrakt §8). */
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

export interface SpawnedProcess {
  kill(): void;
  readonly exited: Promise<number>;
  onLine(cb: (line: string, stream: "out" | "err") => void): void;
  stderrTail(): string;
}

/** Dopina line-splitter do strumienia (stdout LUB stderr) — reużywane też
 *  bezpośrednio dla procesów, gdzie stdout niesie surowe dane binarne
 *  (wtedy dopinany jest tylko do stderr, patrz `streams.ts`). */
export function attachLineReader(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): void {
  let pending = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    pending += chunk;
    let index = pending.indexOf("\n");
    while (index >= 0) {
      const line = pending.slice(0, index).replace(/\r$/, "");
      pending = pending.slice(index + 1);
      onLine(line);
      index = pending.indexOf("\n");
    }
  });
  // Rejestrowane raz na strumień (poza "data") — inaczej każdy chunk dopinał
  // kolejny listener "end" (MaxListenersExceededWarning / wyciek pamięci).
  stream.on("end", () => {
    if (pending.trim() !== "") {
      onLine(pending);
      pending = "";
    }
  });
}

/**
 * Uruchamia proces (yt-dlp) i strumieniowo raportuje linie z obu strumieni —
 * do wywołań, gdzie żaden ze strumieni nie niesie danych binarnych (probe,
 * oraz `spawnYtdlToFifo` poniżej, gdzie tekst postępu leci normalnym
 * stdout/stderr powłoki `sh -c`).
 *
 * `opts.detached`: proces dostaje własną grupę procesów (`setsid`), a
 * `kill()` sygnalizuje całą grupę (`kill(-pid)`), nie tylko `bin` samo —
 * potrzebne dla `spawnYtdlToFifo`, gdzie `bin` to `sh` uruchamiające
 * potok `yt-dlp | cat`: `sh -c "cmd1 | cmd2"` nie robi `exec` (czeka na
 * oba procesy potomne), więc zwykły SIGTERM do samego `sh` zostawiłby
 * yt-dlp/cat jako osierocone procesy.
 */
export function spawnLineProcess(
  bin: string,
  args: string[],
  opts?: { detached?: boolean },
): SpawnedProcess {
  const detached = opts?.detached ?? false;
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], detached });
  let stderrTail = "";
  let exitCode: number | null = null;
  let exitResolve: ((code: number) => void) | undefined;
  const exited = new Promise<number>((resolve) => {
    exitResolve = resolve;
  });

  const lineHandlers: Array<(line: string, stream: "out" | "err") => void> = [];

  attachLineReader(child.stdout!, (line) => {
    for (const handler of lineHandlers) handler(line, "out");
  });
  attachLineReader(child.stderr!, (line) => {
    stderrTail = (stderrTail + "\n" + line).slice(-8000);
    for (const handler of lineHandlers) handler(line, "err");
  });

  child.on("error", (error: unknown) => {
    stderrTail = (stderrTail + "\n" + String(error)).slice(-8000);
    exitCode = 1;
    exitResolve?.(1);
  });
  child.on("close", (code: number | null) => {
    exitCode = code ?? 1;
    exitResolve?.(exitCode);
  });

  const signalGroup = (signal: NodeJS.Signals) => {
    if (detached && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch {
        // grupa mogła już nie istnieć — spróbuj samego procesu niżej
      }
    }
    try {
      child.kill(signal);
    } catch {
      // proces mógł już zakończyć działanie
    }
  };

  return {
    kill() {
      if (exitCode !== null) return;
      signalGroup("SIGTERM");
      setTimeout(() => {
        if (exitCode === null) signalGroup("SIGKILL");
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

/** Cytowanie POSIX sh (pojedyncze cudzysłowy, `'` → `'\''`) — bezpieczne dla
 *  dowolnego tekstu jako pojedynczy argument powłoki, w tym URL-a od usera. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Kluczowy element strumieniowania bez zapisu na dysk: yt-dlp pisze na
 * WŁASNE stdout (`-o -`), które leci przez POWŁOKOWY `|` (pipe(2) w
 * jądrze) do `cat`, a dopiero `cat` pisze do `fifoPath`. To NIE jest to
 * samo, co `yt-dlp -o <fifoPath>` bezpośrednio — a różnica jest krytyczna:
 *
 * Zweryfikowane empirycznie (powtarzalne na realnych filmach): gdy yt-dlp
 * dostaje FIFO jako `-o <path>`, jego WŁASNA logika otwierania plików
 * (`sanitize_open`/`locked_file` w yt-dlp) ściga się z ffmpeg otwierającym
 * ten sam FIFO do odczytu. W praktyce (obserwowane: `open()` yt-dlp blokuje
 * się w oczekiwaniu na czytelnika, podczas gdy ffmpeg, który zdążył otworzyć
 * FIFO wcześniej — zanim yt-dlp w ogóle doszedł do zapisu, bo najpierw robi
 * ekstrakcję strony/JS-challenge, co trwa sekundy — dostaje puste/przedwczesne
 * EOF i kończy się błędem "Invalid data found when processing input", co z
 * kolei ubija zapis yt-dlp przez `BrokenPipeError`. Dotyczy to RÓWNIEŻ
 * pojedynczego FIFO (mp3), nie tylko dwóch (mp4) — pierwotna "weryfikacja"
 * że wariant mp3 działa była niepełna (testowana na jednym konkretnym,
 * nietypowym filmie).
 *
 * `cat`, jako trywialny program, po prostu blokuje się w `open()` do
 * pojawienia się czytelnika (dokładnie zweryfikowany, powtarzalny wzorzec:
 * 3/3 udane przebiegi zarówno dla pojedynczego FIFO, jak i dla dwóch FIFO
 * czytanych jednocześnie przez jeden proces ffmpeg) — nie ma wewnętrznej
 * logiki plikowej, która mogłaby się z kimkolwiek ścigać.
 *
 * `|` jest tu powłokowy, NIE Node `.pipe()` między dwoma procesami
 * potomnymi (patrz duży komentarz w `streams.ts` przy `spawnAudioPipeline`
 * — Node jako pośrednik między stdio dwóch procesów potomnych potrafi cicho
 * gubić dane na tym hoście). Node nigdy nie dotyka bajtów audio/wideo w
 * żadnym z tych dwóch etapów.
 */
export function spawnYtdlToFifo(
  bin: string,
  args: string[],
  url: string,
  fifoPath: string,
): SpawnedProcess {
  const cmd =
    [bin, ...args, "-o", "-", "--", url].map(shQuote).join(" ") + " | cat > " + shQuote(fifoPath);
  return spawnLineProcess("sh", ["-c", cmd], { detached: true });
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
