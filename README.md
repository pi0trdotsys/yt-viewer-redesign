<!--
  future-tech minimal  ·  dark / oklch / aurora
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-->

<!--╔════════════════════════════════════════╗-->
<!--║  ██╗  ██╗████████╗    ██████╗ ██╗   ██╗  ║-->
<!--║  ╚██╗██╔╝╚══██╔══╝    ██╔══██╗╚██╗ ██╔╝  ║-->
<!--║   ╚███╔╝    ██║       ██████╔╝ ╚████╔╝   ║-->
<!--║  ██╔██╗    ██║       ██╔══██╗  ╚██╔╝    ║-->
<!--║  ██╔╝ ██╗  ██║       ██████╔╝   ██║     ║-->
<!--║  ╚═╝  ╚═╝  ╚═╝       ╚═════╝    ╚═╝     ║-->
<!--║       viewer · downloader · self-host   ║-->
<!--╚════════════════════════════════════════╝-->

<div align="center">

## YT Viewer Redesign

> samodzielna usługa pobierania z YouTube — dark minimal UI + backend na Ubuntu

`localhost · 127.0.0.1 · ~/Downloads`
</div>

---

## 0. architektura

```
   ┌──────────────────────────────────────────┐
   │                      domena               │
   │              https://yt.twojadomena.pl     │
   └──────────────┬──────────────────┬───────┘
                  ▼                  ▼
            cloudflared        tunel Cloudflare
                  │                  (Zero Trust)
   ┌──────────────┴──────────────────┴─────────┐
   │  app  (port 3000, 127.0.0.1)              │
   │  ├── Basic Auth                            │
   │  ├── gateway /api/public/*                 │
   │  └── proxy ──────────────────────►   worker │
   │        yt-dlp · ffmpeg (port 8081)        │
   └──────────────────────────────────────────┘
       wolumen ./downloads → pobrane pliki
```

| warstwa     | opis                                              |
| ----------- | ------------------------------------------------- |
| **app**     | TanStack Start · SSR · `node-server` · Basic Auth |
| **gateway** | `/api/public/*` → reverse proxy do workera        |
| **worker**  | yt-dlp + ffmpeg · Bun · SSE + limity              |
| **tunel**   | Cloudflare Tunnel → Twoja poddomena               |

---

## 1. lokalnie

```bash
bun install
bun run dev          # http://localhost:8080
```

> `vite dev` proxy `/api/*` do workera, jeśli on jest uruchomiony
> (`WORKER_URL=http://127.0.0.1:8081` · `WORKER_TOKEN=dev`).

---

## 2. na Ubuntu Server

pełny przewodnik: [`docs/DEPLOY.md`](./docs/DEPLOY.md)

```bash
git clone https://github.com/pi0trdotsys/yt-viewer-redesign
cd yt-viewer-redesign
cp .env.example .env        # AUTH_USER · AUTH_PASSWORD_SHA256 · WORKER_TOKEN · TUNNEL_TOKEN
docker compose up -d --build
```

aplikacja pod `127.0.0.1:3000` (chroniona hasłem), pliki w `./downloads/`.

---

## 3. interfejs

- pole — wklej adres YouTube (`watch` · `shorts` · `playlist`)
- format — `mp3` / `mp4`, jakość 480p → 2160p / 128k → 320k
- pasek transferu — pobieranie · konwersja · gotowe
- kolejka — historia w `localStorage`; pobieraj ponownie

---

## 4. bezpieczeństwo

- **Basic Auth** — każde żądanie odpyta przeglądarkę o login + hasło
- **WORKER_TOKEN** — app → worker, port workera nie publikowany
- **token joba** — HMAC (SHA-256) chroni SSE i pobieranie pliku
- **limity** — równoległe zadania, długość playlisty, długość filmu
- opcjonalnie: **Cloudflare Access** przed domeną

---

## 5. tech

| warstwa  | stack                                         |
| -------- | --------------------------------------------- |
| frontend | TanStack Start · React · Tailwind · shadcn/ui |
| logika   | silnik SSE + polling fallback, zod DTO        |
| backend  | Nitro (`node-server`) · Bun                   |
| worker   | yt-dlp · ffmpeg · Bun · Node Streams          |
| devops   | Docker · docker compose · cloudflared         |

---

<div align="center">

built with ☾ · by <a href="https://pi0tr.dev">piotr</a>

<!-- aurora: primary oklch(0.628 0.258 29.2) -->
</div>
</arg_value>
</write_to_file></tool_call>
