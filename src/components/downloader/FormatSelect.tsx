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
    <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
      <div className="space-y-2">
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
                className={`group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all duration-300 disabled:opacity-50 ${
                  active
                    ? "border-primary/60 bg-primary/10 shadow-[var(--glow-primary)]"
                    : "border-border bg-surface-2/40 hover:border-primary/30"
                }`}
              >
                <Icon
                  className={`size-4 ${active ? "text-primary" : "text-muted-foreground"}`}
                  strokeWidth={1.5}
                />
                <span>
                  <span className="block font-display text-sm font-medium">{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
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
                className={`rounded-md border px-2.5 py-1.5 font-mono text-[11px] tracking-wide transition-colors duration-200 disabled:opacity-50 ${
                  active
                    ? "border-accent/60 bg-accent/15 text-foreground"
                    : "border-border bg-surface-2/40 text-muted-foreground hover:text-foreground"
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
