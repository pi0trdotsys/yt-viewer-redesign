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
  const active = job?.status === "downloading" || job?.status === "converting";

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-2/40 p-5">
      <div className="flex items-center justify-between">
        <span className="label-mono">Transfer</span>
        <span
          className={`font-mono text-[11px] tracking-[0.18em] uppercase ${
            job?.status === "error" ? "text-destructive" : "text-primary"
          }`}
        >
          {STATUS_LABEL[job?.status ?? "idle"]}
        </span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <span className="font-display text-4xl tabular-nums text-aurora">
          {progress.toFixed(1)}
          <span className="text-xl">%</span>
        </span>
        <span className="pb-1 font-mono text-[11px] text-muted-foreground">
          {formatBytes(job?.downloadedBytes)} / {formatBytes(job?.totalBytes)}
        </span>
      </div>

      <div
        className={`h-1.5 w-full overflow-hidden rounded-full bg-muted ${active ? "scanline" : ""}`}
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${progress}%`, background: "var(--gradient-aurora)" }}
        />
      </div>

      <div className="grid grid-cols-3 gap-4 border-t border-border pt-4">
        <Metric label="Prędkość" value={formatSpeed(job?.speedBytesPerSec)} />
        <Metric label="ETA" value={formatEta(job?.etaSec)} />
        <Metric label="Format" value={job ? `${job.format} · ${job.quality}` : "—"} />
      </div>

      {job?.error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {job.error}
        </p>
      ) : null}
    </div>
  );
}
