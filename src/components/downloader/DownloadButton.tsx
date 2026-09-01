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
      className={`group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-lg px-4 py-3.5 font-display text-[13px] font-semibold tracking-[0.14em] uppercase transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-40 sm:gap-3 sm:px-6 sm:py-4 sm:text-sm sm:tracking-[0.18em] ${
        busy
          ? "border border-destructive/50 bg-destructive/10 text-destructive"
          : "border border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 hover:shadow-[var(--glow-primary)]"
      }`}
    >
      {busy ? (
        <>
          <Square className="size-4" strokeWidth={2} />
          Przerwij
        </>
      ) : (
        <>
          <ArrowDownToLine
            className="size-4 transition-transform duration-300 group-hover:translate-y-0.5"
            strokeWidth={2}
          />
          Pobierz
        </>
      )}
    </button>
  );
}
