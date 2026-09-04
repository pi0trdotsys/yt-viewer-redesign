import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Heart, KeyRound, ShieldCheck } from "lucide-react";
import { UrlField } from "@/components/downloader/UrlField";
import { FormatSelect } from "@/components/downloader/FormatSelect";
import { TransferPanel } from "@/components/downloader/TransferPanel";
import { DownloadButton } from "@/components/downloader/DownloadButton";
import { QueueList } from "@/components/downloader/QueueList";
import {
  DEFAULT_QUALITY,
  type MediaFormat,
  type UrlFieldState,
} from "@/components/downloader/types";
import { useDownloader } from "@/lib/downloader/useDownloader";
import { parseYoutubeUrl } from "@/lib/downloader/validate";
import type { SessionResponseDto, SessionUser } from "@/lib/auth/types.shared";
import { accentClasses, initials } from "@/lib/auth/avatar";

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
  const { jobs, start, cancel, retry, clearFinished } = useDownloader();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);

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

  const activeJob = jobs.find((j) => j.status === "downloading" || j.status === "resolving");
  const canStart = urlState === "valid" && !activeJob;

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

  // Ogłoszenia zmian statusu dla czytników ekranu (kontrakt §12).
  const announcement = useMemo(() => {
    const active = jobs.filter(
      (j) => j.status === "downloading" || j.status === "resolving",
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
          <div className="mb-8 sm:mb-10">
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 font-mono text-[10px] tracking-[0.14em] text-muted-foreground sm:text-[11px]">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] ${accentClasses(me.accent).avatar}`}
                aria-hidden
              >
                {me.avatar ?? initials(me.name)}
              </span>
              <span>
                Zalogowano jako <span className="text-foreground">{me.name}</span>
              </span>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={() => setPasswordOpen((v) => !v)}
                className="flex items-center gap-1 underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                <KeyRound className="size-3" strokeWidth={1.75} />
                Zmień hasło
              </button>
              {me.role === "admin" ? (
                <>
                  <span aria-hidden>·</span>
                  <Link
                    to="/admin"
                    className="flex items-center gap-1 underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    <ShieldCheck className="size-3" strokeWidth={1.75} />
                    Panel admina
                  </Link>
                </>
              ) : null}
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={handleLogout}
                className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Wyloguj
              </button>
            </div>
            {passwordOpen ? <ChangePasswordForm onDone={() => setPasswordOpen(false)} /> : null}
          </div>
        ) : null}

        <div className="rise space-y-8 sm:space-y-10">
          <UrlField
            value={url}
            onChange={setUrl}
            onSubmit={() => {
              if (canStart) handleStart();
            }}
            state={urlState}
            hint="watch · shorts · playlist"
            message={
              urlState === "invalid"
                ? "To nie wygląda na poprawny link YouTube (watch, shorts, playlist lub youtu.be)."
                : urlState === "valid"
                  ? "Link rozpoznany — wybierz format i jakość."
                  : "Obsługiwane: youtube.com/watch, /shorts, /playlist oraz youtu.be."
            }
          />

          <FormatSelect
            format={format}
            quality={quality}
            onFormatChange={handleFormatChange}
            onQualityChange={setQuality}
          />

          <DownloadButton
            busy={Boolean(activeJob)}
            disabled={!canStart && !activeJob}
            hint={
              activeJob
                ? undefined
                : urlState === "neutral"
                  ? "Wklej link, aby rozpocząć"
                  : urlState === "invalid"
                    ? "Popraw link, aby rozpocząć"
                    : `${format.toUpperCase()} · ${quality}`
            }
            onStart={handleStart}
            onCancel={() => handleCancel()}
          />

          <TransferPanel job={activeJob} onCancel={handleCancel} />

          <QueueList
            jobs={jobs}
            onCancel={handleCancel}
            onRetry={handleRetry}
            onClearFinished={clearFinished}
          />
        </div>

        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
      </div>

      <footer className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center pb-6 pt-10 sm:pb-8">
        <div className="pointer-events-auto flex items-center gap-1.5 font-mono text-[10px] tracking-[0.22em] text-muted-foreground transition-colors hover:text-foreground sm:text-[11px]">
          <span>Crafted with</span>
          <Heart className="size-3 fill-primary/20 text-primary animate-pulse" aria-hidden />
          <span>by NullPointerStudio</span>
        </div>
      </footer>
    </main>
  );
}

/** Samoobsługowa zmiana własnego hasła (`PUT /api/auth/password`) — dostępna
 *  dla każdego zalogowanego konta, nie tylko admina. */
function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    void fetch("/api/auth/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "Nie udało się zmienić hasła");
          return;
        }
        toast.success("Hasło zmienione");
        setCurrent("");
        setNext("");
        onDone();
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={submit}
      className="glass relative mx-auto mt-4 max-w-xs space-y-3 rounded-xl p-4 text-left sm:max-w-sm"
    >
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <input
          required
          type="password"
          placeholder="Aktualne hasło"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className="field-input"
        />
        <input
          required
          type="password"
          minLength={8}
          placeholder="Nowe hasło (min. 8 znaków)"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          className="field-input"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-9 rounded-lg border border-primary/40 bg-primary/8 px-4 py-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-foreground transition-colors duration-300 hover:border-primary/70 hover:bg-primary/16 disabled:opacity-40"
        >
          Zapisz
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-9 rounded-lg border border-border/60 px-4 py-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground transition-colors duration-300 hover:border-foreground/30 hover:text-foreground"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}
