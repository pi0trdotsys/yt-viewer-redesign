import type { PublicUser } from "./types.shared";

/**
 * Prezentacja avatara/koloru usera — współdzielone między `/login`
 * (profile picker) i `/` (nagłówek "Zalogowano jako…").
 */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Klasy zależne od AUTH_ACCENT_n (domyślnie "primary") — kontrakt: tylko tokeny. */
export function accentClasses(accent: PublicUser["accent"]) {
  if (accent === "navy") {
    return {
      tile: "hover:border-accent-navy/50 hover:shadow-[var(--glow-navy)] focus-visible:border-accent-navy/50 focus-visible:shadow-[var(--glow-navy)]",
      avatar: "border-accent-navy/30 bg-accent-navy/10 text-accent-navy",
    };
  }
  return {
    tile: "hover:border-primary/50 hover:shadow-[var(--glow-primary)] focus-visible:border-primary/50 focus-visible:shadow-[var(--glow-primary)]",
    avatar: "border-primary/30 bg-primary/10 text-primary",
  };
}
