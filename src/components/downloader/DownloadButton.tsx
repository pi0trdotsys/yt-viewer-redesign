import { ArrowDownToLine, Square } from "lucide-react";

interface DownloadButtonProps {
  busy?: boolean;
  disabled?: boolean;
  onStart: () => void;
  onCancel: () => void;
}

export function DownloadButton({ busy, disabled, onStart, onCancel }: DownloadButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={busy ? onCancel : onStart}
      className={`group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl border px-6 py-4 font-mono text-[12px] tracking-[0.32em] uppercase transition-all duration-500 disabled:cursor-not-allowed disabled:opacity-35 sm:text-[13px] ${
        busy
          ? "border-destructive/45 bg-destructive/8 text-destructive hover:bg-destructive/14"
          : "border-primary/40 bg-primary/8 text-foreground hover:border-primary/70 hover:bg-primary/16 hover:shadow-[var(--glow-primary)]"
      }`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-primary/15 to-transparent transition-transform duration-700 group-hover:translate-x-full"
      />
      {busy ? (
        <>
          <Square className="size-3.5" strokeWidth={2} />
          Przerwij
        </>
      ) : (
        <>
          <ArrowDownToLine
            className="size-4 text-primary transition-transform duration-500 group-hover:translate-y-0.5"
            strokeWidth={1.75}
          />
          Pobierz
        </>
      )}
    </button>
  );
}
