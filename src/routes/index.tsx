import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import type { PublicUser, SessionResponseDto } from "@/lib/auth/types.shared";

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
  const [me, setMe] = useState<PublicUser | null>(null);

  // Hydration-safe: kim jesteśmy (spójne z odczytem localStorage w useDownloader).
  useEffect(() => {
    void fetch("/api/auth/session")
      .then((res) => res.json() as Promise<SessionResponseDto>)
      .then((data) => setMe(data.user))
      .catch(() => undefined);
  }, []);

  const handleLogout = () => {
    void fetch("/api/auth/logout", { method: "POST" }).finally(() =>
      window.location.assign("/login"),
    );
  };

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
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-40" />
      <div className="halo relative mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-4 py-12 sm:px-6 sm:py-16 lg:max-w-2xl">
        <header className="mb-10 flex justify-center sm:mb-14">
          <h1 className="font-display text-lg leading-none tracking-tight text-foreground/90 sm:text-xl">
            Downloader
          </h1>
        </header>

        {me ? (
          <div className="mb-8 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.14em] text-muted-foreground sm:mb-10 sm:text-[11px]">
            <span>
              Zalogowano jako <span className="text-foreground">{me.name}</span>
            </span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={handleLogout}
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Wyloguj
            </button>
          </div>
        ) : null}

        <div className="rise space-y-8 sm:space-y-10">
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
