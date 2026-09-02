import { useState } from "react";
import { ArrowDownToLine, ChevronDown, RotateCcw, X } from "lucide-react";
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
  onReveal,
  onClearFinished,
}: QueueListProps) {
  const [open, setOpen] = useState(defaultOpen);
  const activeCount = jobs.filter(
    (j) => j.status === "downloading" || j.status === "converting",
  ).length;

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="label-mono flex min-w-0 items-center gap-2 truncate transition-colors duration-300 hover:text-foreground"
        >
          <ChevronDown
            className={`size-3 shrink-0 transition-transform duration-500 ${open ? "" : "-rotate-90"}`}
            strokeWidth={1.5}
          />
          Kolejka · {jobs.length}
          {activeCount > 0 ? ` · ${activeCount} aktywne` : ""}
        </button>
        <button
          type="button"
          onClick={onClearFinished}
          className="shrink-0 rounded-full border border-border/60 px-3 py-1 font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground transition-colors duration-300 hover:border-foreground/30 hover:text-foreground"
        >
          wyczyść
        </button>
      </div>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          {jobs.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground/70">
              Kolejka jest pusta
            </p>
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => {
                const busy = job.status === "downloading" || job.status === "converting";
                return (
                  <li
                    key={job.id}
                    className="flex items-center gap-3 rounded-xl border border-border/50 bg-surface-2/20 px-4 py-3 transition-colors duration-300 hover:border-border"
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${DOT[job.status]} ${
                        busy ? "[animation:breathe_1.6s_ease-in-out_infinite]" : ""
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{job.title ?? job.url}</p>
                      <p className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground sm:text-[11px]">
                        {job.format} · {job.quality} · {formatDuration(job.durationSec)} ·{" "}
                        {STATUS_LABEL[job.status]}
                        {busy ? ` ${job.progress.toFixed(0)}%` : ""}
                      </p>
                      {busy ? (
                        <div className="mt-2 h-px w-full overflow-hidden rounded-full bg-border">
                          <div
                            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {job.status === "done" ? (
                        <button
                          type="button"
                          aria-label="Pobierz plik"
                          onClick={() => onReveal?.(job)}
                          className="p-2.5 sm:p-1.5 text-muted-foreground transition-colors duration-300 hover:text-primary"
                        >
                          <ArrowDownToLine className="size-3.5" strokeWidth={1.5} />
                        </button>
                      ) : null}
                      {job.status === "error" ? (
                        <button
                          type="button"
                          aria-label="Ponów"
                          onClick={() => onRetry?.(job.id)}
                          className="p-2.5 sm:p-1.5 text-muted-foreground transition-colors duration-300 hover:text-foreground"
                        >
                          <RotateCcw className="size-3.5" strokeWidth={1.5} />
                        </button>
                      ) : null}
                      {busy ? (
                        <button
                          type="button"
                          aria-label="Anuluj"
                          onClick={() => onCancel?.(job.id)}
                          className="p-2.5 sm:p-1.5 text-muted-foreground transition-colors duration-300 hover:text-destructive"
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
