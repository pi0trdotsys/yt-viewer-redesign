import { AudioLines, Film } from "lucide-react";
import { QUALITY_OPTIONS, type MediaFormat } from "./types";

interface FormatSelectProps {
  format: MediaFormat;
  quality: string;
  onFormatChange: (format: MediaFormat) => void;
  onQualityChange: (quality: string) => void;
  disabled?: boolean;
}

const FORMATS: { id: MediaFormat; label: string; sub: string; Icon: typeof Film }[] = [
  { id: "mp3", label: "MP3", sub: "Tylko audio", Icon: AudioLines },
  { id: "mp4", label: "MP4", sub: "Wideo + audio", Icon: Film },
];

export function FormatSelect({
  format,
  quality,
  onFormatChange,
  onQualityChange,
  disabled,
}: FormatSelectProps) {
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-start">
      <div className="space-y-3">
        <span className="label-mono">Format</span>
        <div role="radiogroup" aria-label="Format pliku" className="grid grid-cols-2 gap-2">
          {FORMATS.map(({ id, label, sub, Icon }) => {
            const active = format === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => onFormatChange(id)}
                className={`group relative flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border px-3 py-3.5 text-left transition-all duration-500 disabled:opacity-50 sm:px-4 ${
                  active
                    ? "border-primary/45 bg-primary/8 text-foreground"
                    : "border-border/60 bg-surface-2/20 text-muted-foreground hover:border-primary/25 hover:bg-surface-2/40 hover:text-foreground"
                }`}
              >
                <Icon
                  className={`size-4 shrink-0 transition-colors duration-300 ${
                    active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                  }`}
                  strokeWidth={1.5}
                />
                <span className="min-w-0">
                  <span className="block font-display text-sm leading-tight">{label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>
                </span>
                <span
                  aria-hidden
                  className={`pointer-events-none absolute inset-x-3 bottom-0 hairline-top transition-opacity duration-500 ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <span className="label-mono">Jakość</span>
        <div className="flex flex-wrap gap-1.5">
          {QUALITY_OPTIONS[format].map((q) => {
            const active = q === quality;
            return (
              <button
                key={q}
                type="button"
                disabled={disabled}
                aria-pressed={active}
                onClick={() => onQualityChange(q)}
                className={`rounded-full border px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] transition-all duration-300 disabled:opacity-50 ${
                  active
                    ? "border-primary/50 bg-primary/12 text-foreground shadow-[var(--glow-primary)]"
                    : "border-border/60 bg-transparent text-muted-foreground hover:border-foreground/25 hover:text-foreground"
                }`}
              >
                {q}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
