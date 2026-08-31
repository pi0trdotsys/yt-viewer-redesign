# CLAUDE — pełny kontrakt implementacyjny (YT Downloader)

Wersja: 1.0 · Zakres: warstwa logiki pod gotowymi makietami UI.
Dokument nadrzędny wobec `docs/CLAUDE_IMPLEMENTATION.md` (tamten jest skrótem).

---

## 0. Zasady nienaruszalne

1. **Nie zmieniaj plików w `src/components/downloader/*` ani `src/routes/index.tsx` poza podmianą mocków na realny stan.** UI jest prezentacyjny i bezstanowy względem backendu.
2. **Nie wpisuj kolorów wprost.** Wyłącznie tokeny z `src/styles.css` (`bg-background`, `text-primary`, `border-border`, `shadow-[var(--glow-primary)]`). Nowy kolor = nowy token.
3. **Backend nie formatuje tekstu.** Wysyła liczby (`etaSec`, `speedBytesPerSec`, `downloadedBytes`); formatowanie robią helpery w `types.ts`.
4. **Nie dodawaj innego routera** niż `@tanstack/react-router`. Brak `react-router-dom`, brak `src/pages`, brak `App.tsx`.
5. **Nie edytuj `src/routeTree.gen.ts`** (generowany).
6. Aktualizacje postępu **throttlowane do maks. ~4/s** po stronie silnika.

---

## 1. Stos technologiczny (stan faktyczny repo)

| Warstwa        | Technologia                      | Wersja          |
| -------------- | -------------------------------- | --------------- |
| Framework      | TanStack Start                   | 1.168.32        |
| Router         | TanStack Router                  | 1.170.18        |
| Plugin routera | @tanstack/router-plugin          | 1.168.23        |
| UI             | React / React DOM                | ^19.2.0         |
| Build          | Vite                             | 8.1.5           |
| Server runtime | Nitro (edge/worker)              | 3.0.260603-beta |
| Style          | Tailwind CSS + @tailwindcss/vite | ^4.2.1          |
| Dane async     | @tanstack/react-query            | ^5.101.1        |
| Walidacja      | zod                              | ^3.24.2         |
| Ikony          | lucide-react                     | ^0.575.0        |
| Toasty         | sonner                           | ^2.0.7          |
| Typy           | TypeScript                       | ^5.8.3          |

Pomocnicze (już zainstalowane, wolno używać bez dodawania zależności):
`clsx`, `tailwind-merge`, `class-variance-authority`, `react-hook-form` + `@hookform/resolvers`, `date-fns`, `recharts`, komplet `@radix-ui/react-*`, `cmdk`, `vaul`, `embla-carousel-react`, `input-otp`, `react-day-picker`, `react-resizable-panels`, `tw-animate-css`.

Dev/jakość: `eslint` ^9, `typescript-eslint` ^8.56, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `prettier` ^3.7 (+ `eslint-config-prettier`, `eslint-plugin-prettier`), `@types/node` ^22, `vite-tsconfig-paths`, `@lovable.dev/vite-tanstack-config`.

Skrypty: `dev`, `build`, `build:dev`, `preview`, `lint`, `format`.

### 1.1 Zależności do dodania (propozycja, wymaga akceptacji właściciela)

| Paczka             | Cel | Uwaga                                        |
| ------------------ | --- | -------------------------------------------- |
| brak obowiązkowych | —   | logika może powstać na `fetch` + Web Streams |

**Zakazane w runtime serwerowym (worker):** `child_process` (spawn/exec — stub, rzuca `[unenv] ... is not implemented yet!`), `sharp`, `canvas`, `puppeteer`, `fs.watch`, `os.cpus()`, pakiety z `node-gyp`/`.node`. Oznacza to, że **`yt-dlp`/`ffmpeg` nie mogą być uruchamiane jako podproces w warstwie serwerowej aplikacji**. Dopuszczalne modele:

- **A. Zewnętrzny worker** (VPS/kontener) z `yt-dlp` + `ffmpeg`, wystawiony jako HTTP API; aplikacja tylko proxuje i strumieniuje postęp.
- **B. Lokalny host** (Electron/Tauri/CLI) — UI działa jako klient lokalnego demona na `localhost`.
- **C. Gotowe API third-party** — wtedy klucz trafia do sekretu środowiskowego, czytanego **wewnątrz `.handler()`**.

Wybór modelu jest decyzją implementującego; kontrakt UI jest identyczny we wszystkich trzech.

---

## 2. Mapa plików

| Plik                                           | Status           | Rola                                                 |
| ---------------------------------------------- | ---------------- | ---------------------------------------------------- |
| `src/routes/index.tsx`                         | istnieje         | Ekran główny, składa komponenty, trzyma stan UI      |
| `src/components/downloader/types.ts`           | istnieje         | **Kontrakt typów — źródło prawdy**                   |
| `src/components/downloader/UrlField.tsx`       | istnieje         | Pole URL, `state: neutral \| valid \| invalid`       |
| `src/components/downloader/FormatSelect.tsx`   | istnieje         | MP3/MP4 + jakość                                     |
| `src/components/downloader/TransferPanel.tsx`  | istnieje         | Postęp, prędkość, ETA, rozmiar                       |
| `src/components/downloader/QueueList.tsx`      | istnieje         | Kolejka/historia                                     |
| `src/components/downloader/DownloadButton.tsx` | istnieje         | Start/Stop                                           |
| `src/lib/downloader/types.shared.ts`           | **do napisania** | Typy DTO wspólne klient/serwer                       |
| `src/lib/downloader/validate.ts`               | **do napisania** | Parsowanie i walidacja URL (czysta funkcja)          |
| `src/lib/downloader/engine.ts`                 | **do napisania** | Interfejs `DownloaderEngine` + implementacja klienta |
| `src/lib/downloader/useDownloader.ts`          | **do napisania** | Hook spinający engine ze stanem React                |
| `src/lib/downloader/jobs.functions.ts`         | **do napisania** | `createServerFn` — start/cancel/status               |
| `src/lib/downloader/provider.server.ts`        | **do napisania** | Integracja z workerem/API (server-only)              |
| `src/routes/api/public/progress.$jobId.ts`     | **do napisania** | SSE ze strumieniem postępu (jeśli model A/C)         |

Reguły umiejscowienia (wymuszone przez bundler):

- Pliki importowane przez komponenty: `src/lib/**`, nazwa `*.functions.ts`.
- Kod wyłącznie serwerowy: sufiks `*.server.ts`. Komponent **nigdy** nie importuje `*.server.ts`.
- Każdy plik z `createServerFn` musi być cienki: tylko importy, typy i eksportowane deklaracje funkcji serwerowych. Żadnych helperów, stałych ani mocków w module scope.
- `process.env['X']` czytać **wewnątrz** `.handler()`, nigdy w module scope. Zmienne przeglądarkowe: `import.meta.env.VITE_*`.

---

## 3. Kontrakt typów

Źródło: `src/components/downloader/types.ts` (nie modyfikować pól bez aktualizacji tego dokumentu).

```ts
type MediaFormat = "mp3" | "mp4";
type JobStatus =
  "idle" | "resolving" | "downloading" | "converting" | "done" | "error" | "canceled";
type UrlFieldState = "neutral" | "valid" | "invalid";

interface DownloadJob {
  id: string; // uuid v4, stabilne przez cały cykl życia
  url: string; // oryginalny URL wpisany przez użytkownika
  title?: string; // uzupełniane po `resolving`
  thumbnailUrl?: string;
  durationSec?: number;
  format: MediaFormat;
  quality: string; // patrz §5
  status: JobStatus;
  progress: number; // 0..100, monotonicznie rosnące w obrębie statusu
  speedBytesPerSec?: number; // średnia ruchoma z ~3 s
  etaSec?: number; // sekundy, liczba zmiennoprzecinkowa dozwolona
  downloadedBytes?: number;
  totalBytes?: number; // undefined dla strumieni o nieznanym rozmiarze
  outputPath?: string; // ustawiane wyłącznie przy status === "done"
  error?: string; // ustawiane wyłącznie przy status === "error"
}
```

Helpery formatujące (istnieją, używać ich zamiast własnych): `formatBytes`, `formatSpeed`, `formatEta`, `formatDuration`, `STATUS_LABEL`, `QUALITY_OPTIONS`, `DEFAULT_QUALITY`.

Zod jako pojedyncze źródło runtime-walidacji DTO:

```ts
// src/lib/downloader/types.shared.ts
export const startInputSchema = z.object({
  url: z.string().url().max(2048),
  format: z.enum(["mp3", "mp4"]),
  quality: z.string().max(16),
});
export type StartInput = z.infer<typeof startInputSchema>;
```

---

## 4. Interfejs silnika

```ts
export interface DownloaderEngine {
  start(input: StartInput): Promise<string>; // -> jobId
  cancel(jobId: string): Promise<void>;
  retry(jobId: string): Promise<string>; // -> nowy jobId
  list(): Promise<DownloadJob[]>;
  subscribe(cb: (job: DownloadJob) => void): () => void; // zwraca unsubscribe
}
```

Wymagania:

- `subscribe` emituje **pełny obiekt joba**, nie diff.
- Throttling emisji: maks. 4 zdarzenia/s na joba; ostatnia emisja przy zmianie statusu jest zawsze natychmiastowa (nie throttlowana).
- `cancel` jest idempotentne; po nim job kończy się statusem `canceled`, nie `error`.
- `retry` dopuszczalne wyłącznie dla `error` i `canceled`.
- Odsubskrybowanie musi zamykać transport (SSE/WebSocket), gdy nie ma subskrybentów.

---

## 5. Maszyna stanów

```text
idle → resolving → downloading → [converting] → done
          │             │              │
          └──────► error ◄─────────────┘
          └──────► canceled ◄──────────┘
```

Reguły przejść:

- `converting` występuje zawsze dla `mp3` i dla `mp4` wymagającego muxowania.
- W `converting` `progress` liczony jest osobno od 0 (UI pokazuje po prostu bieżącą wartość).
- Ze stanów terminalnych (`done`, `error`, `canceled`) nie ma przejść — tylko nowy job przez `retry`.
- Przy `error` obowiązkowe pole `error` z komunikatem dla użytkownika (§8).

---

## 6. Walidacja URL

Rozpoznawane wzorce:

| Wzorzec                        | Przykład                                      | Efekt           |
| ------------------------------ | --------------------------------------------- | --------------- |
| `youtube.com/watch?v=ID`       | `https://www.youtube.com/watch?v=abc12345678` | 1 job           |
| `youtu.be/ID`                  | `https://youtu.be/abc12345678`                | 1 job           |
| `youtube.com/shorts/ID`        | `https://www.youtube.com/shorts/abc12345678`  | 1 job           |
| `youtube.com/playlist?list=ID` | `…/playlist?list=PL…`                         | N jobów (batch) |
| `music.youtube.com/watch?v=ID` | —                                             | 1 job           |

Szczegóły:

- ID wideo: `[A-Za-z0-9_-]{11}`. ID playlisty: `[A-Za-z0-9_-]{12,42}`.
- Dopuszczalne prefiksy hosta: `www.`, `m.`, `music.`; protokół `http`/`https`; brak protokołu → doklej `https://`.
- Parametry `t`, `si`, `feature`, `pp` ignorowane.
- `watch?v=…&list=…` → traktuj jako **pojedyncze wideo**, chyba że użytkownik jawnie wybierze playlistę (poza zakresem obecnej makiety).
- Funkcja walidująca musi być czysta i synchroniczna: `parseYoutubeUrl(raw: string): { kind: "video" | "playlist"; id: string } | null`.
- Mapowanie na `UrlFieldState`: pusty string → `neutral`, `null` z parsera → `invalid`, wynik → `valid`.

---

## 7. Mapowanie jakości

| Format | Dozwolone `quality`                       | Domyślna  |
| ------ | ----------------------------------------- | --------- |
| `mp3`  | `128kbps`, `192kbps`, `320kbps`           | `320kbps` |
| `mp4`  | `480p`, `720p`, `1080p`, `1440p`, `2160p` | `1080p`   |

- Zmiana formatu **resetuje** `quality` do domyślnej (już zaimplementowane w UI).
- Jeśli żądana jakość niedostępna → wybierz najbliższą **niższą**, ustaw job normalnie i dopisz informację przez toast (`sonner`), nie przez `job.error`.
- Serwer waliduje `quality` względem `QUALITY_OPTIONS[format]` i odrzuca spoza listy (400).

---

## 8. Błędy

`job.error` renderowane jest dosłownie. Wymagane komunikaty w języku polskim, bez stack trace:

| Przyczyna                         | Komunikat                                 |
| --------------------------------- | ----------------------------------------- |
| Geoblokada                        | `Film niedostępny w Twoim regionie`       |
| Wideo prywatne / wymaga logowania | `Wymagane logowanie (wideo prywatne)`     |
| Usunięte / zły ID                 | `Nie znaleziono filmu pod tym adresem`    |
| Brak miejsca                      | `Brak miejsca na dysku`                   |
| Sieć / timeout                    | `Przerwane połączenie — spróbuj ponownie` |
| Ograniczenie wiekowe              | `Film z ograniczeniem wiekowym`           |
| Nieznane                          | `Nie udało się pobrać pliku`              |

Logi techniczne trafiają wyłącznie na serwer. Kody błędów w DTO: `code: "GEO" | "PRIVATE" | "NOT_FOUND" | "DISK" | "NETWORK" | "AGE" | "UNKNOWN"` — mapowanie kod → komunikat po stronie klienta, w jednym miejscu.

---

## 9. Transport postępu

Preferowane SSE (`text/event-stream`) z endpointu `src/routes/api/public/progress.$jobId.ts`.
Prefiks `/api/public/*` omija autoryzację serwisu — **handler musi sam weryfikować wywołującego** (token joba w query lub nagłówku, walidowany zodem, porównanie w czasie stałym).

Format zdarzenia:

```text
event: job
data: {"id":"…","status":"downloading","progress":39.5,"speedBytesPerSec":6574571,"etaSec":34.97,"downloadedBytes":155189248,"totalBytes":393216000}
```

- Heartbeat co 15 s (`: ping`).
- Reconnect po stronie klienta: backoff 1s → 2s → 5s → 10s, maks. 5 prób, potem `error: NETWORK`.
- Po statusie terminalnym serwer zamyka strumień.

---

## 10. Persystencja

- Kolejka i historia przechowywane po stronie klienta w `localStorage`, klucz `ytdl.queue.v1`, wersjonowany, walidowany zodem przy odczycie (odrzuć rekordy niezgodne, nie rzucaj wyjątkiem).
- Odczyt **wyłącznie w `useEffect`** lub za `useHydrated()` — nie w inicjalizatorze `useState` (hydration mismatch).
- Joby w stanie nieterminalnym po restarcie oznacz jako `canceled`, chyba że serwer potwierdzi ich życie w `list()`.
- Historia ograniczona do 100 ostatnich rekordów.

---

## 11. Design system

Tokeny w `src/styles.css` (paleta YouTube, ciemna baza):

| Token                                                              | Znaczenie                   |
| ------------------------------------------------------------------ | --------------------------- |
| `--background` `oklch(0.145 0 0)`                                  | tło aplikacji               |
| `--foreground` `oklch(0.985 0 0)`                                  | tekst podstawowy            |
| `--surface`, `--surface-2`                                         | powierzchnie warstwowe      |
| `--primary` / `--ring` / `--destructive` `oklch(0.628 0.258 29.2)` | czerwień YT                 |
| `--accent` `oklch(0.985 0 0)`                                      | biel akcentowa              |
| `--muted-foreground`                                               | tekst drugorzędny           |
| `--border`, `--input`                                              | hairline'y i pola           |
| `--gradient-aurora`, `--glow-primary`, `--glow-soft`               | efekty (używane oszczędnie) |
| `--radius` `0.25rem`                                               | promień bazowy              |

Typografia: `--font-display` Abril Fatface (nagłówki / display), `--font-sans` Cabin (tekst), `--font-mono` JetBrains Mono (dane techniczne).
Liczby telemetryczne zawsze `font-mono` + `tabular-nums`.
Fonty ładowane `<link>` w `src/routes/__root.tsx` — **nigdy** `@import` zdalnego URL w `styles.css`.

---

## 12. Dostępność

- `TransferPanel` ma `role="progressbar"` z `aria-valuenow/min/max` — utrzymać przy zmianach.
- Przyciski akcji w kolejce mają `aria-label` (`Ponów`, `Anuluj`).
- Zmiana statusu joba ogłaszana w `aria-live="polite"` (do dodania w warstwie logiki, jeden region na stronę).
- Pełna obsługa klawiatury dla `radiogroup` formatu (strzałki) — do uzupełnienia.

---

## 13. Testy (do napisania)

| Zakres         | Plik                                      | Minimum                                                                        |
| -------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| Formatery      | `src/components/downloader/types.test.ts` | `formatBytes(0/1023/1024/1.5GB)`, `formatEta(0/59/60/3599)`, `undefined → "—"` |
| Parser URL     | `src/lib/downloader/validate.test.ts`     | wszystkie wzorce z §6 + 10 przypadków negatywnych                              |
| Maszyna stanów | `src/lib/downloader/engine.test.ts`       | brak przejść z terminalnych, idempotentny `cancel`                             |
| Throttling     | `engine.test.ts`                          | ≤4 emisje/s, natychmiastowa emisja przy zmianie statusu                        |

Uruchamianie: `bunx vitest run`. Lint: `bun run lint`. Typy: `tsgo`.

---

## 14. Definition of Done

- [ ] `parseYoutubeUrl` + testy
- [ ] `DownloaderEngine` (start/cancel/retry/list/subscribe) + testy
- [ ] Server fn `jobs.functions.ts` z walidacją zod i mapowaniem błędów na kody
- [ ] SSE endpoint z weryfikacją wywołującego i heartbeatem
- [ ] `useDownloader` podpięty w `src/routes/index.tsx`, `MOCK_JOBS` usunięte
- [ ] Persystencja `ytdl.queue.v1` z migracją i hydration-safe odczytem
- [ ] Obsługa playlist (batch)
- [ ] Wybór katalogu docelowego (obecnie tylko wyświetlany nagłówek `~/Downloads`)
- [ ] `bun run lint` i build bez błędów
- [ ] Zero hardkodowanych kolorów w diffie
