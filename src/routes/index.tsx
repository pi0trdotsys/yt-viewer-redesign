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
      { title: "YT Downloader — pobieranie" },
      {
        name: "description",
        content:
          "Minimalistyczny interfejs do pobierania filmów i audio z YouTube — pole URL, format MP3/MP4, postęp transferu i kolejka zadań.",
      },
      { property: "og:title", content: "YT Downloader — pobieranie" },
      {
        property: "og:description",
        content:
          "Minimalistyczny interfejs do pobierania filmów i audio z YouTube.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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
  const handleCancel = (_jobId?: string) => {};

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-16 sm:py-24">
        <header className="mb-16 flex items-baseline justify-between">
          <h1 className="font-display text-lg font-medium tracking-tight">
            YT Downloader
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            ~/Downloads
          </span>
        </header>

        <div className="space-y-12">
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

          <DownloadButton
            busy={Boolean(activeJob)}
            disabled={urlState === "invalid"}
            onStart={handleStart}
            onCancel={handleCancel}
          />

          <TransferPanel job={activeJob} onCancel={handleCancel} />
        </div>

        <div className="mt-16">
          <QueueList jobs={MOCK_JOBS} onCancel={handleCancel} />
        </div>
      </div>
    </main>
  );
}
