import { X } from "lucide-react";
import { STATUS_LABEL, formatBytes, formatEta, formatSpeed, type DownloadJob } from "./types";

interface TransferPanelProps {
  job?: DownloadJob | undefined;
  onCancel?: (jobId: string) => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <span className="label-mono block text-[10px]">{label}</span>
      <span className="block truncate font-mono text-xs tabular-nums text-foreground/90 sm:text-sm">
        {value}
      </span>
    </div>
  );
}

export function TransferPanel({ job, onCancel }: TransferPanelProps) {
  const progress = job?.progress ?? 0;
  const active = job?.status === "downloading";
  const indeterminate = job?.status === "resolving" || job?.status === "queued";

  return (
    <div className="glass relative space-y-6 rounded-2xl p-5 sm:p-7">
      <span aria-hidden className="absolute inset-x-6 top-0 hairline-top opacity-60" />

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="font-display text-5xl leading-none tabular-nums tracking-tight sm:text-6xl">
          {progress.toFixed(1)}
          <span className="ml-1 font-mono text-lg text-muted-foreground sm:text-xl">%</span>
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <span
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[10px] tracking-[0.2em] uppercase ${
              job?.status === "error"
                ? "border-destructive/45 text-destructive"
                : "border-border/70 text-muted-foreground"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                active || indeterminate
                  ? "bg-primary [animation:breathe_1.6s_ease-in-out_infinite]"
                  : job?.status === "error"
                    ? "bg-destructive"
                    : "bg-muted-foreground/50"
              }`}
            />
            {STATUS_LABEL[job?.status ?? "idle"]}
          </span>
          {active && job ? (
            <button
              type="button"
              aria-label="Anuluj pobieranie"
              onClick={() => onCancel?.(job.id)}
              className="flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1.5 font-mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground transition-colors duration-300 hover:border-destructive/60 hover:text-destructive"
            >
              <X className="size-3" strokeWidth={1.5} />
              Anuluj
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`h-[3px] w-full overflow-hidden rounded-full bg-border/50 ${
          indeterminate ? "scanline" : ""
        }`}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full bg-linear-to-r from-primary/60 to-primary transition-[width] duration-700 ease-out ${
            active ? "shimmer" : ""
          }`}
          style={{ width: `${indeterminate ? 0 : progress}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-5 border-t border-border/50 pt-5 sm:grid-cols-3">
        <Metric
          label="Pobrano"
          value={`${formatBytes(job?.downloadedBytes)} / ${formatBytes(job?.totalBytes)}`}
        />
        <Metric label="Prędkość" value={formatSpeed(job?.speedBytesPerSec)} />
        <Metric label="ETA" value={formatEta(job?.etaSec)} />
      </div>

      {job?.error ? <p className="font-mono text-[11px] text-destructive">{job.error}</p> : null}
    </div>
  );
}
