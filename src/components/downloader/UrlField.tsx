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
      ? "border-primary/60 shadow-[var(--glow-primary)]"
      : state === "invalid"
        ? "border-destructive/70"
        : "border-border focus-within:border-primary/50";

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2">
        <span className="label-mono truncate">Źródło</span>
        {hint ? (
          <span className="shrink-0 truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
            {hint}
          </span>
        ) : null}
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg bg-surface-2/60 px-3 py-3 transition-all duration-300 sm:gap-3 sm:px-4 ${ringClass}`}
        style={{ borderWidth: 1 }}
      >
        <Link2
          className={`size-4 shrink-0 ${state === "invalid" ? "text-destructive" : "text-primary"}`}
          strokeWidth={1.5}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          spellCheck={false}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="Adres URL filmu YouTube"
          className="w-full min-w-0 bg-transparent font-mono text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 disabled:opacity-50 sm:text-sm"
        />
        {state === "valid" ? (
          <CheckCircle2 className="size-4 shrink-0 text-primary" strokeWidth={1.5} />
        ) : null}
        {state === "invalid" ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" strokeWidth={1.5} />
        ) : null}
      </div>
    </div>
  );
}
