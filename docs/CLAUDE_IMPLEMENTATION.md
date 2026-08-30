# YT Downloader — makiety UI i kontrakt implementacyjny

Dokument dla osoby/agenta (Claude) implementującego logikę pod gotowymi makietami.
UI jest **prezentacyjne i bezstanowe względem backendu** — cały stan pochodzi z propsów/callbacków.

## 1. Zakres makiet

| Plik | Rola |
| --- | --- |
| `src/routes/index.tsx` | Ekran główny (Downloader console) — składa całość |
| `src/components/downloader/UrlField.tsx` | Pole URL + walidacja wizualna |
| `src/components/downloader/FormatSelect.tsx` | Wybór mp3 / mp4 + jakość |
| `src/components/downloader/TransferPanel.tsx` | Postęp, prędkość, ETA, rozmiar |
| `src/components/downloader/QueueList.tsx` | Kolejka / historia zadań |
| `src/components/downloader/DownloadButton.tsx` | Akcja główna (start/stop) |
| `src/components/downloader/types.ts` | **Kontrakt typów — źródło prawdy** |

## 2. Kontrakt typów

Zobacz `src/components/downloader/types.ts`. Kluczowe:

```ts
type MediaFormat = "mp3" | "mp4";
type JobStatus = "idle" | "resolving" | "downloading" | "converting" | "done" | "error" | "canceled";

interface DownloadJob {
  id: string;
  url: string;
  title?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  format: MediaFormat;
  quality: string;          // np. "320kbps" | "1080p"
  status: JobStatus;
  progress: number;         // 0..100
  speedBytesPerSec?: number;
  etaSec?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  outputPath?: string;
  error?: string;
}
```

**Zasada:** backend nie formatuje tekstu. Wysyła liczby (`etaSec`, `speedBytesPerSec`),
UI formatuje przez helpery w `types.ts` (`formatSpeed`, `formatEta`, `formatBytes`).
To naprawia obecny problem widoczny na zrzucie (`ETA: 34.973932613327314s`).

## 3. Punkty podpięcia logiki

W `src/routes/index.tsx` znajdują się TODO-handlery:

- `onStart(url, format, quality)` — walidacja URL, utworzenie joba, start pobierania.
- `onCancel(jobId)` — przerwanie transferu, sprzątanie plików tymczasowych.
- `onRetry(jobId)` — ponowienie zadania po błędzie.
- `onClearFinished()` — czyszczenie zakończonych z kolejki.
- `onRevealFile(job)` — otwarcie katalogu wynikowego.

Zalecany kształt warstwy logiki (odseparowanej od UI):

```ts
// src/lib/downloader/engine.ts (do napisania)
export interface DownloaderEngine {
  start(input: { url: string; format: MediaFormat; quality: string }): Promise<string>; // -> jobId
  cancel(jobId: string): Promise<void>;
  subscribe(cb: (job: DownloadJob) => void): () => void; // strumień aktualizacji
}
```

UI oczekuje aktualizacji **nie częściej niż ~4/s** (throttling po stronie silnika),
inaczej pasek postępu drga.

## 4. Walidacja URL

UI pokazuje trzy stany pola: `neutral | valid | invalid` (prop `state`).
Logika ma rozpoznawać: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/shorts/`,
`youtube.com/playlist?list=`. Playlisty → kolejka wielu jobów.

## 5. Mapowanie jakości

| Format | Dozwolone wartości `quality` |
| --- | --- |
| `mp3` | `128kbps`, `192kbps`, `320kbps` |
| `mp4` | `480p`, `720p`, `1080p`, `1440p`, `2160p` |

Zmiana formatu musi resetować `quality` do wartości domyślnej (`320kbps` / `1080p`).

## 6. Obsługa błędów

`job.error` jest wyświetlany dosłownie w `QueueList`. Backend powinien podawać
komunikaty przyjazne użytkownikowi (nie stack trace), np.:
`"Film niedostępny w Twoim regionie"`, `"Brak miejsca na dysku"`, `"Wymagane logowanie (wideo prywatne)"`.

## 7. Design system

Wszystkie kolory/efekty są tokenami w `src/styles.css`
(`--primary` cyan, `--accent` magenta, `--surface`, `--glow-primary`, `--gradient-aurora`).
**Nie wpisuj kolorów bezpośrednio w komponentach.** Nowy kolor = nowy token.

Typografia: Space Grotesk (nagłówki), DM Sans (tekst), JetBrains Mono (dane techniczne, liczby).
Liczby telemetryczne zawsze monospace + `tabular-nums`, żeby nie skakały.

## 8. Co pozostaje do zrobienia

- [ ] `engine.ts` (yt-dlp/ffmpeg lub API) + strumień zdarzeń
- [ ] Persystencja kolejki i historii między uruchomieniami
- [ ] Wybór katalogu docelowego (obecnie tylko wyświetlany)
- [ ] Obsługa playlist (batch)
- [ ] Testy formaterów w `types.ts`
