import { X } from "lucide-react";
import { STATUS_LABEL, formatBytes, formatEta, formatSpeed, type DownloadJob } from "./types";

interface TransferPanelProps {
  job?: DownloadJob | undefined;
  onCancel?: (jobId: string) => void;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="label-mono block">{label}</span>
      <span className="block truncate font-mono text-xs tabular-nums text-foreground sm:text-sm">
        {value}
      </span>
    </div>
  );
}

export function TransferPanel({ job, onCancel }: TransferPanelProps) {
  const progress = job?.progress ?? 0;
  const active = job?.status === "downloading" || job?.status === "converting";
  const indeterminate = job?.status === "resolving";

  return (
    <div className="space-y-5 border-t border-border pt-6 sm:pt-8">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3">
        <span className="font-display text-4xl font-light tabular-nums tracking-tight transition-opacity duration-300 sm:text-5xl">
          {progress.toFixed(1)}
          <span className="text-xl text-muted-foreground sm:text-2xl">%</span>
        </span>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
          <span
            className={`font-mono text-[11px] tracking-[0.18em] uppercase ${
              job?.status === "error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {STATUS_LABEL[job?.status ?? "idle"]}
          </span>
          {active && job ? (
            <button
              type="button"
              aria-label="Anuluj pobieranie"
              onClick={() => onCancel?.(job.id)}
              className="flex items-center gap-1 rounded-sm border border-border px-2 py-1 font-mono text-[10px] tracking-[0.14em] uppercase text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive"
            >
              <X className="size-3" strokeWidth={1.5} />
              Anuluj
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={`h-px w-full overflow-hidden bg-border ${indeterminate ? "scanline" : ""}`}
        role="progressbar"
        aria-valuenow={indeterminate ? undefined : Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full bg-primary transition-[width] duration-500 ease-out ${
            active ? "animate-pulse" : ""
          }`}
          style={{ width: `${indeterminate ? 0 : progress}%` }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
