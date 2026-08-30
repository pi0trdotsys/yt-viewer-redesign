export type MediaFormat = "mp3" | "mp4";

export type JobStatus =
  | "idle"
  | "resolving"
  | "downloading"
  | "converting"
  | "done"
  | "error"
  | "canceled";

export interface DownloadJob {
  id: string;
  url: string;
  title?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  format: MediaFormat;
  quality: string;
  status: JobStatus;
  /** 0..100 */
  progress: number;
  speedBytesPerSec?: number;
  etaSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  outputPath?: string;
  error?: string;
}

export type UrlFieldState = "neutral" | "valid" | "invalid";

export const QUALITY_OPTIONS: Record<MediaFormat, string[]> = {
  mp3: ["128kbps", "192kbps", "320kbps"],
  mp4: ["480p", "720p", "1080p", "1440p", "2160p"],
};

export const DEFAULT_QUALITY: Record<MediaFormat, string> = {
  mp3: "320kbps",
  mp4: "1080p",
};

export const STATUS_LABEL: Record<JobStatus, string> = {
  idle: "Oczekuje",
  resolving: "Analiza",
  downloading: "Pobieranie",
  converting: "Konwersja",
  done: "Gotowe",
  error: "Błąd",
  canceled: "Anulowano",
};

export function formatBytes(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec?: number): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) return "—";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

export function formatDuration(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
