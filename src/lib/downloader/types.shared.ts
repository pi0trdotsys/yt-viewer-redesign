import { z } from "zod";

/**
 * Wspólne DTO klient/serwer (kontrakt: docs/CLAUDE_CONTRACT.md §3).
 * Źródłem prawdy dla UI pozostaje `src/components/downloader/types.ts` —
 * ten moduł opisuje wyłącznie transport sieciowy.
 */

export const MEDIA_FORMATS = ["mp3", "mp4"] as const;
export type MediaFormatDto = (typeof MEDIA_FORMATS)[number];

export const QUALITY_OPTIONS_DTO: Record<MediaFormatDto, readonly string[]> = {
  mp3: ["128kbps", "192kbps", "320kbps"],
  mp4: ["480p", "720p", "1080p", "1440p", "2160p"],
};

export const JOB_ERROR_CODES = [
  "GEO",
  "PRIVATE",
  "NOT_FOUND",
  "DISK",
  "NETWORK",
  "AGE",
  "UNKNOWN",
] as const;
export type JobErrorCode = (typeof JOB_ERROR_CODES)[number];

export const startInputSchema = z.object({
  url: z.string().url().max(2048),
  format: z.enum(MEDIA_FORMATS),
  quality: z.string().max(16),
});
export type StartInput = z.infer<typeof startInputSchema>;

export const jobStatusSchema = z.enum([
  "idle",
  "resolving",
  "downloading",
  "converting",
  "done",
  "error",
  "canceled",
]);

/**
 * Job w transporcie. Nadbiory względem `DownloadJob`:
 * - `errorCode`  — maszynowy kod błędu (komunikat PL mapuje klient),
 * - `streamToken`— token HMAC joba do SSE/pobrania pliku (sekretny, serwer),
 * - `hasFile`    — czy istnieje pobralny plik (status done).
 */
export const jobDtoSchema = z.object({
  id: z.string().min(1),
  url: z.string().max(2048),
  title: z.string().max(512).optional(),
  thumbnailUrl: z.string().url().optional(),
  durationSec: z.number().nonnegative().optional(),
  format: z.enum(MEDIA_FORMATS),
  quality: z.string().max(16),
  status: jobStatusSchema,
  progress: z.number().min(0).max(100),
  speedBytesPerSec: z.number().nonnegative().optional(),
  etaSec: z.number().nonnegative().optional(),
  downloadedBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  outputPath: z.string().max(1024).optional(),
  error: z.string().max(512).optional(),
  errorCode: z.enum(JOB_ERROR_CODES).optional(),
  streamToken: z.string().max(128).optional(),
  hasFile: z.boolean().optional(),
});
export type JobDto = z.infer<typeof jobDtoSchema>;

export const jobListDtoSchema = z.object({
  jobs: z.array(jobDtoSchema),
});
