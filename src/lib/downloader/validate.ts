/**
 * Parser URL YouTube — czysta, synchroniczna funkcja (kontrakt §6).
 * Rozpoznaje: watch?v=, youtu.be/, shorts/, playlist?list=, music.youtube.com.
 */

export type ParsedYoutubeUrl = {
  kind: "video" | "playlist";
  id: string;
};

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]{12,42}$/;

/** Parametry ignorowane przy parsowaniu (kontrakt §6). */
const IGNORED_PARAMS = new Set(["t", "si", "feature", "pp"]);

export function parseYoutubeUrl(raw: string): ParsedYoutubeUrl | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  const bareHost = host.replace(/^(www|m)\./, "");
  const isYoutubeHost =
    bareHost === "youtube.com" || bareHost === "music.youtube.com" || bareHost === "youtu.be";
  if (!isYoutubeHost) return null;

  // youtu.be/<ID> — wyłącznie wideo.
  if (bareHost === "youtu.be") {
    const id = url.pathname.split("/")[1] ?? "";
    return VIDEO_ID_RE.test(id) ? { kind: "video", id } : null;
  }

  const path = url.pathname.replace(/\/+$/, "");

  // /watch?v=<ID> — jeśli w URL jest też &list=, traktujemy jako pojedyncze wideo.
  if (path === "/watch") {
    for (const key of IGNORED_PARAMS) url.searchParams.delete(key);
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID_RE.test(id) ? { kind: "video", id } : null;
  }

  // /shorts/<ID>
  if (path.startsWith("/shorts/")) {
    const id = path.slice("/shorts/".length);
    return VIDEO_ID_RE.test(id) ? { kind: "video", id } : null;
  }

  // /playlist?list=<ID>
  if (path === "/playlist") {
    const id = url.searchParams.get("list") ?? "";
    return PLAYLIST_ID_RE.test(id) ? { kind: "playlist", id } : null;
  }

  return null;
}
