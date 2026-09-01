import { Link2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { UrlFieldState } from "./types";

interface UrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  state?: UrlFieldState;
  disabled?: boolean;
  hint?: string;
}

export function UrlField({ value, onChange, state = "neutral", disabled, hint }: UrlFieldProps) {
  const ringClass =
    state === "valid"
      ? "border-primary/50 shadow-[var(--glow-primary)]"
      : state === "invalid"
        ? "border-destructive/60"
        : "border-border/70 focus-within:border-primary/40";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <span className="label-mono truncate">Źródło</span>
        {hint ? (
          <span className="shrink-0 truncate font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 sm:text-[11px]">
            {hint}
          </span>
        ) : null}
      </div>

      <div
        className={`group relative flex items-center gap-3 rounded-xl border bg-surface-2/30 px-4 py-4 transition-all duration-500 ${ringClass}`}
      >
        <Link2
          className={`size-4 shrink-0 transition-colors duration-300 ${
            state === "invalid" ? "text-destructive" : "text-primary/80"
          }`}
          strokeWidth={1.5}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="Adres URL filmu YouTube"
          className="w-full min-w-0 bg-transparent font-mono text-[13px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 sm:text-sm"
        />
        {state === "valid" ? (
          <CheckCircle2 className="size-4 shrink-0 animate-scale-in text-primary" strokeWidth={1.5} />
        ) : null}
        {state === "invalid" ? (
          <AlertTriangle className="size-4 shrink-0 animate-scale-in text-destructive" strokeWidth={1.5} />
        ) : null}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-4 bottom-0 hairline-top transition-opacity duration-500 ${
            state === "valid" ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
    </div>
  );
}
