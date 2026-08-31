import { useState } from "react";
import { ChevronDown, RotateCcw, X } from "lucide-react";
import { STATUS_LABEL, formatDuration, type DownloadJob } from "./types";

interface QueueListProps {
  jobs: DownloadJob[];
  defaultOpen?: boolean;
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
  defaultOpen = true,
  onCancel,
  onRetry,
  onClearFinished,
}: QueueListProps) {
  const [open, setOpen] = useState(defaultOpen);
  const activeCount = jobs.filter(
    (j) => j.status === "downloading" || j.status === "converting",
  ).length;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="label-mono flex items-center gap-2 transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`size-3 transition-transform duration-300 ${open ? "" : "-rotate-90"}`}
            strokeWidth={1.5}
          />
          Kolejka · {jobs.length}
          {activeCount > 0 ? ` · ${activeCount} aktywne` : ""}
        </button>
        <button
          type="button"
          onClick={onClearFinished}
          className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          wyczyść
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {jobs.length === 0 ? (
            <p className="py-6 text-xs text-muted-foreground">Kolejka jest pusta.</p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {jobs.map((job) => {
                const busy = job.status === "downloading" || job.status === "converting";
                return (
                  <li key={job.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`size-1 shrink-0 rounded-full ${DOT[job.status]} ${
                        busy ? "animate-pulse" : ""
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{job.title ?? job.url}</p>
                      <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                        {job.format} · {job.quality} · {formatDuration(job.durationSec)} ·{" "}
                        {STATUS_LABEL[job.status]}
                        {busy ? ` ${job.progress.toFixed(0)}%` : ""}
                      </p>
                      {busy ? (
                        <div className="mt-2 h-px w-full bg-border">
                          <div
                            className="h-full bg-primary transition-[width] duration-500 ease-out"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      ) : null}
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
        </div>
      </div>
    </section>
  );
}
