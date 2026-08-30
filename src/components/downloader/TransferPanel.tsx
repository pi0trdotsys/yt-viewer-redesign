import {
  STATUS_LABEL,
  formatBytes,
  formatEta,
  formatSpeed,
  type DownloadJob,
} from "./types";

interface TransferPanelProps {
  job?: DownloadJob | undefined;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <span className="label-mono block">{label}</span>
      <span className="block font-mono text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function TransferPanel({ job }: TransferPanelProps) {
  const progress = job?.progress ?? 0;

  return (
    <div className="space-y-5 border-t border-border pt-8">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-5xl font-light tabular-nums tracking-tight">
          {progress.toFixed(1)}
          <span className="text-2xl text-muted-foreground">%</span>
        </span>
        <span
          className={`font-mono text-[11px] tracking-[0.18em] uppercase ${
            job?.status === "error" ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {STATUS_LABEL[job?.status ?? "idle"]}
        </span>
      </div>

      <div
        className="h-px w-full bg-border"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Metric label="Pobrano" value={`${formatBytes(job?.downloadedBytes)} / ${formatBytes(job?.totalBytes)}`} />
        <Metric label="Prędkość" value={formatSpeed(job?.speedBytesPerSec)} />
        <Metric label="ETA" value={formatEta(job?.etaSec)} />
      </div>

      {job?.error ? (
        <p className="font-mono text-[11px] text-destructive">{job.error}</p>
      ) : null}
    </div>
  );
}
