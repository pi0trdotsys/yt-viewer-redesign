import { z } from "zod";

/**
 * Wspólne DTO klient/serwer dla modelu strumieniowego (worker `/streams`,
 * patrz `worker/src/streams.ts`). Źródłem prawdy dla UI pozostaje
 * `src/components/downloader/types.ts` — ten moduł opisuje wyłącznie
 * transport sieciowy.
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

export const streamStatusSchema = z.enum(["resolving", "downloading", "done", "error", "canceled"]);
export type StreamStatusDto = z.infer<typeof streamStatusSchema>;

/**
 * Bilet strumienia w transporcie — odpowiednik `StreamDto` z workera. Bez
 * `outputPath`/`hasFile` (nie ma pliku na serwerze) — pobieranie leci wprost
 * do przeglądarki, jednorazowym linkiem `token`.
 */
export const streamDtoSchema = z.object({
  id: z.string().min(1),
  status: streamStatusSchema,
  progress: z.number().min(0).max(100),
  title: z.string().max(512).optional(),
  durationSec: z.number().nonnegative().optional(),
  thumbnailUrl: z.string().url().optional(),
  speedBytesPerSec: z.number().nonnegative().optional(),
  etaSec: z.number().nonnegative().optional(),
  downloadedBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  error: z.string().max(512).optional(),
  errorCode: z.enum(JOB_ERROR_CODES).optional(),
});
export type StreamDto = z.infer<typeof streamDtoSchema>;

/** Odpowiedź `POST /api/public/streams` — pojedyncze wideo (bilet + token
 *  jednorazowego pobrania) albo playlista (lista URL-i do rozwinięcia po
 *  stronie klienta, patrz `engine.ts`). */
export const createStreamResponseSchema = z.discriminatedUnion("kind", [
  streamDtoSchema.extend({ kind: z.literal("video"), token: z.string().min(1) }),
  z.object({
    kind: z.literal("playlist"),
    title: z.string().max(512).optional(),
    entries: z.array(z.string().url()),
  }),
]);
export type CreateStreamResponse = z.infer<typeof createStreamResponseSchema>;
