import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { UrlField } from "@/components/downloader/UrlField";
import { FormatSelect } from "@/components/downloader/FormatSelect";
import { TransferPanel } from "@/components/downloader/TransferPanel";
import { DownloadButton } from "@/components/downloader/DownloadButton";
import { QueueList } from "@/components/downloader/QueueList";
import {
  DEFAULT_QUALITY,
  type DownloadJob,
  type MediaFormat,
  type UrlFieldState,
} from "@/components/downloader/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "YT Downloader — konsola pobierania" },
      {
        name: "description",
        content:
          "Minimalistyczna, futurystyczna makieta interfejsu aplikacji do pobierania filmów i audio z YouTube.",
      },
      { property: "og:title", content: "YT Downloader — konsola pobierania" },
      {
        property: "og:description",
        content:
          "Makieta UI: pole URL, wybór formatu MP3/MP4, telemetria transferu i kolejka zadań.",
      },
    ],
  }),
  component: Index,
});

/** Dane wyłącznie poglądowe — do podmiany na stan z silnika pobierania. */
const MOCK_JOBS: DownloadJob[] = [
  {
    id: "j1",
    url: "https://www.youtube.com/watch?v=3k19DtTaTZk",
    title: "Nocny przejazd przez Tokio — 4K ambient",
    durationSec: 742,
    format: "mp4",
    quality: "1080p",
    status: "downloading",
    progress: 39.5,
    speedBytesPerSec: 6.27 * 1024 * 1024,
    etaSec: 34.97,
    downloadedBytes: 148 * 1024 * 1024,
    totalBytes: 375 * 1024 * 1024,
  },
  {
    id: "j2",
    url: "https://youtu.be/abc123",
    title: "Lo-fi set — 2h",
    durationSec: 7210,
    format: "mp3",
    quality: "320kbps",
    status: "done",
    progress: 100,
    outputPath: "~/Downloads/lofi-set.mp3",
  },
  {
    id: "j3",
    url: "https://youtu.be/xyz789",
    title: "Materiał niedostępny",
    format: "mp4",
    quality: "720p",
    status: "error",
    progress: 0,
    error: "Film niedostępny w Twoim regionie",
  },
];

function Index() {
  const [url, setUrl] = useState("https://www.youtube.com/watch?v=3k19DtTaTZk");
  const [format, setFormat] = useState<MediaFormat>("mp4");
  const [quality, setQuality] = useState<string>(DEFAULT_QUALITY.mp4);

  // Makieta: prosta heurystyka wizualna. Realną walidację dostarcza logika.
  const urlState: UrlFieldState = useMemo(() => {
    if (url.trim() === "") return "neutral";
    return /youtube\.com\/(watch|shorts|playlist)|youtu\.be\//.test(url)
      ? "valid"
      : "invalid";
  }, [url]);

  const activeJob = MOCK_JOBS.find(
    (j) => j.status === "downloading" || j.status === "converting",
  );

  const handleFormatChange = (next: MediaFormat) => {
    setFormat(next);
    setQuality(DEFAULT_QUALITY[next]);
  };

  // TODO(logika): podpiąć DownloaderEngine — patrz docs/CLAUDE_IMPLEMENTATION.md
  const handleStart = () => {};
  const handleCancel = () => {};

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="grid-field pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[42rem] -translate-x-1/2 rounded-full opacity-20 blur-[120px]"
        style={{ background: "var(--gradient-aurora)" }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-14">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="label-mono">v2.0 · makieta interfejsu</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              YT <span className="text-aurora">Downloader</span>
            </h1>
          </div>
          <div className="text-right">
            <span className="label-mono block">Katalog</span>
            <span className="font-mono text-xs text-muted-foreground">~/Downloads</span>
          </div>
        </header>

        <section className="panel space-y-7 rounded-xl p-6 sm:p-8">
          <UrlField
            value={url}
            onChange={setUrl}
            state={urlState}
            hint="watch · shorts · playlist"
          />
          <FormatSelect
            format={format}
            quality={quality}
            onFormatChange={handleFormatChange}
            onQualityChange={setQuality}
          />
          <TransferPanel job={activeJob} />
          <DownloadButton
            busy={Boolean(activeJob)}
            disabled={urlState === "invalid"}
            onStart={handleStart}
            onCancel={handleCancel}
          />
        </section>

        <QueueList jobs={MOCK_JOBS} />

        <footer className="mt-auto pt-4">
          <p className="font-mono text-[11px] text-muted-foreground">
            Makieta prezentacyjna — logika opisana w docs/CLAUDE_IMPLEMENTATION.md
          </p>
        </footer>
      </div>
    </main>
  );
}
