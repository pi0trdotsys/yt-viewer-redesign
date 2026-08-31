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
import { useDownloader } from "@/lib/downloader/useDownloader";
import { parseYoutubeUrl } from "@/lib/downloader/validate";

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
        content: "Minimalistyczny interfejs do pobierania filmów i audio z YouTube.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<MediaFormat>("mp4");
  const [quality, setQuality] = useState<string>(DEFAULT_QUALITY.mp4);
  const { jobs, start, cancel, retry, clearFinished, getDownloadUrl } = useDownloader();

  // Walidacja URL: parser z warstwy logiki (kontrakt §6).
  const urlState: UrlFieldState = useMemo(() => {
    if (url.trim() === "") return "neutral";
    return parseYoutubeUrl(url) ? "valid" : "invalid";
  }, [url]);

  const activeJob = jobs.find((j) => j.status === "downloading" || j.status === "converting");

  const handleFormatChange = (next: MediaFormat) => {
    setFormat(next);
    setQuality(DEFAULT_QUALITY[next]);
  };

  const handleStart = () => {
    void start({ url: url.trim(), format, quality });
  };

  const handleCancel = (jobId?: string) => {
    const target = jobId ?? activeJob?.id;
    if (target) void cancel(target);
  };

  const handleRetry = (jobId: string) => {
    void retry(jobId);
  };

  const handleReveal = (job: DownloadJob) => {
    const downloadUrl = getDownloadUrl(job.id);
    if (!downloadUrl) return;
    const anchor = document.createElement("a");
    anchor.href = downloadUrl;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  // Ogłoszenia zmian statusu dla czytników ekranu (kontrakt §12).
  const announcement = useMemo(() => {
    const active = jobs.filter(
      (j) => j.status === "downloading" || j.status === "converting",
    ).length;
    const done = jobs.filter((j) => j.status === "done").length;
    return `Aktywne pobierania: ${active}. Ukończone: ${done}.`;
  }, [jobs]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-16 sm:py-24">
        <header className="mb-16 flex items-baseline justify-between">
          <h1 className="font-display text-lg font-medium tracking-tight">YT Downloader</h1>
          <span className="font-mono text-[11px] text-muted-foreground">~/Downloads</span>
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
            onCancel={() => handleCancel()}
          />

          <TransferPanel job={activeJob} onCancel={handleCancel} />
        </div>

        <div className="mt-16">
          <QueueList
            jobs={jobs}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onReveal={handleReveal}
            onClearFinished={clearFinished}
          />
        </div>

        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>
    </main>
  );
}
