import { Link2, CheckCircle2, AlertTriangle, ClipboardPaste, X } from "lucide-react";
import type { UrlFieldState } from "./types";

interface UrlFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  state?: UrlFieldState;
  disabled?: boolean;
  hint?: string;
  message?: string;
}

export function UrlField({
  value,
  onChange,
  onSubmit,
  state = "neutral",
  disabled,
  hint,
  message,
}: UrlFieldProps) {
  const ringClass =
    state === "valid"
      ? "border-primary/50 shadow-[var(--glow-primary)]"
      : state === "invalid"
        ? "border-destructive/60"
        : "border-border/70 focus-within:border-primary/40";

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.trim());
    } catch {
      /* brak dostępu do schowka — użytkownik wkleja ręcznie */
    }
  };

  return (
    <div className="space-y-3">
      {/* Na wąskim ekranie etykieta i podpowiedź walczyły o ten sam wiersz
          (podpowiedź jako shrink-0 wypychała etykietę do ucięcia elipsą) —
          od sm: wracają na jeden wiersz, bo wtedy obie się mieszczą. */}
      <div className="flex flex-col gap-1 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-2">
        <label htmlFor="yt-url" className="label-mono sm:truncate">
          Wklej link z YouTube
        </label>
        {hint ? (
          <span className="font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 sm:shrink-0 sm:truncate sm:text-[11px]">
            {hint}
          </span>
        ) : null}
      </div>

      <div
        className={`group relative flex min-h-14 items-center gap-2 rounded-xl border bg-surface-2/30 px-3 py-2 transition-all duration-500 sm:gap-3 sm:px-4 ${ringClass}`}
      >
        <Link2
          className={`size-4 shrink-0 transition-colors duration-300 ${
            state === "invalid" ? "text-destructive" : "text-primary/80"
          }`}
          strokeWidth={1.5}
        />
        <input
          id="yt-url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSubmit?.();
          }}
          disabled={disabled}
          spellCheck={false}
          autoComplete="off"
          inputMode="url"
          enterKeyHint="go"
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="Adres URL filmu YouTube"
          aria-invalid={state === "invalid"}
          className="h-10 w-full min-w-0 bg-transparent font-mono text-[13px] tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50 sm:text-sm"
        />
        {value ? (
          <button
            type="button"
            aria-label="Wyczyść pole"
            onClick={() => onChange("")}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-300 hover:bg-surface-2/60 hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Wklej ze schowka"
            onClick={() => void handlePaste()}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors duration-300 hover:bg-surface-2/60 hover:text-foreground"
          >
            <ClipboardPaste className="size-4" strokeWidth={1.5} />
          </button>
        )}
        {state === "valid" ? (
          <CheckCircle2
            className="size-4 shrink-0 animate-scale-in text-primary"
            strokeWidth={1.5}
          />
        ) : null}
        {state === "invalid" ? (
          <AlertTriangle
            className="size-4 shrink-0 animate-scale-in text-destructive"
            strokeWidth={1.5}
          />
        ) : null}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-4 bottom-0 hairline-top transition-opacity duration-500 ${
            state === "valid" ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>

      {message ? (
        <p
          role={state === "invalid" ? "alert" : undefined}
          className={`font-mono text-[11px] leading-relaxed ${
            state === "invalid" ? "text-destructive" : "text-muted-foreground/70"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
