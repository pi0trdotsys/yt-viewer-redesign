import { RotateCcw, X } from "lucide-react";
import { STATUS_LABEL, formatDuration, type DownloadJob } from "./types";

interface QueueListProps {
  jobs: DownloadJob[];
  onCancel?: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onReveal?: (job: DownloadJob) => void;
  onClearFinished?: () => void;
}

const DOT: Record<DownloadJob["status"], string> = {
  idle: "bg-muted-foreground/40",
  resolving: "bg-foreground",
  downloading: "bg-primary",
  converting: "bg-foreground",
  done: "bg-muted-foreground/40",
  error: "bg-destructive",
  canceled: "bg-muted-foreground/40",
};

export function QueueList({
  jobs,
  onCancel,
  onRetry,
  onClearFinished,
}: QueueListProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="label-mono">Kolejka · {jobs.length}</span>
        <button
          type="button"
          onClick={onClearFinished}
          className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          wyczyść
        </button>
      </div>

      {jobs.length === 0 ? (
        <p className="py-6 text-xs text-muted-foreground">Kolejka jest pusta.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {jobs.map((job) => {
            const busy = job.status === "downloading" || job.status === "converting";
            return (
              <li key={job.id} className="flex items-center gap-3 py-3">
                <span className={`size-1 shrink-0 rounded-full ${DOT[job.status]}`} />
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
                      className="p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <RotateCcw className="size-3.5" strokeWidth={1.5} />
                    </button>
                  ) : null}
                  {busy ? (
                    <button
                      type="button"
                      aria-label="Anuluj"
                      onClick={() => onCancel?.(job.id)}
                      className="p-1 text-muted-foreground transition-colors hover:text-destructive"
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
