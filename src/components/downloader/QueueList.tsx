import { FolderOpen, RotateCcw, X } from "lucide-react";
import { STATUS_LABEL, formatDuration, type DownloadJob } from "./types";

interface QueueListProps {
  jobs: DownloadJob[];
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onReveal?: (job: DownloadJob) => void;
  onClearFinished?: () => void;
}

const DOT: Record<DownloadJob["status"], string> = {
  idle: "bg-muted-foreground",
  resolving: "bg-accent",
  downloading: "bg-primary animate-pulse",
  converting: "bg-accent animate-pulse",
  done: "bg-primary",
  error: "bg-destructive",
  canceled: "bg-muted-foreground",
};

export function QueueList({
  jobs,
  onCancel,
  onRetry,
  onReveal,
  onClearFinished,
}: QueueListProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="label-mono">Kolejka · {jobs.length}</span>
        <button
          type="button"
          onClick={onClearFinished}
          className="font-mono text-[11px] tracking-wide text-muted-foreground transition-colors hover:text-primary"
        >
          wyczyść zakończone
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          Kolejka jest pusta.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-2/30">
          {jobs.map((job) => {
            const busy = job.status === "downloading" || job.status === "converting";
            return (
              <li key={job.id} className="flex items-center gap-4 px-4 py-3">
                <span className={`size-1.5 shrink-0 rounded-full ${DOT[job.status]}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{job.title ?? job.url}</p>
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {job.format} · {job.quality} · {formatDuration(job.durationSec)} ·{" "}
                    {STATUS_LABEL[job.status]}
                    {busy ? ` ${job.progress.toFixed(0)}%` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {job.status === "error" ? (
                    <button
                      type="button"
                      aria-label="Ponów"
                      onClick={() => onRetry?.(job.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary"
                    >
                      <RotateCcw className="size-3.5" strokeWidth={1.5} />
                    </button>
                  ) : null}
                  {job.status === "done" ? (
                    <button
                      type="button"
                      aria-label="Pokaż plik"
                      onClick={() => onReveal?.(job)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary"
                    >
                      <FolderOpen className="size-3.5" strokeWidth={1.5} />
                    </button>
                  ) : null}
                  {busy ? (
                    <button
                      type="button"
                      aria-label="Anuluj"
                      onClick={() => onCancel?.(job.id)}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-destructive"
                    >
                      <X className="size-3.5" strokeWidth={1.5} />
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
