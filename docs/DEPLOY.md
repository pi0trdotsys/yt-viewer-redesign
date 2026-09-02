# Wdrożenie na Ubuntu Server (Docker + Cloudflare Tunnel)

Architektura: `docker-compose.yml` uruchamia trzy usługi:

| Usługa        | Rola                                                                  | Port                   |
| ------------- | --------------------------------------------------------------------- | ---------------------- |
| `app`         | Aplikacja TanStack Start (SSR + logowanie + gateway `/api/public/*`) | 3000 (tylko localhost) |
| `worker`      | yt-dlp + ffmpeg (Bun), API + SSE + serwowanie plików                  | 8081 (wewnętrzny)      |
| `cloudflared` | Tunel Cloudflare → `app:3000`                                         | —                      |

Pobrane pliki lądują w `./downloads` na hoście (volume `/data` workera).

## 1. Wymagania

```sh
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER   # przeloguj się po tej komendzie
```

## 2. Kod

```sh
git clone https://github.com/pi0trdotsys/yt-viewer-redesign
cd yt-viewer-redesign
```

## 3. Konfiguracja

```sh
cp .env.example .env
openssl rand -hex 32              # → WORKER_TOKEN
openssl rand -hex 32              # → SESSION_SECRET
echo -n "HasloAlice" | sha256sum  # → AUTH_PASSWORD_SHA256_1 (bez spacji z echo -n)
echo -n "HasloBob" | sha256sum    # → AUTH_PASSWORD_SHA256_2
echo -n "HasloCarol" | sha256sum  # → AUTH_PASSWORD_SHA256_3
nano .env
```

Uzupełnij w `.env`:

- `AUTH_USER_1..3` / `AUTH_PASSWORD_SHA256_1..3` / `AUTH_NAME_1..3` — trzy
  konta widoczne jako kafelki na ekranie logowania,
- opcjonalnie `AUTH_AVATAR_1..3` (pojedynczy emoji zamiast inicjałów) i
  `AUTH_ACCENT_1..3` (`primary` domyślnie albo `navy`),
- `SESSION_SECRET` — losowy sekret podpisujący ciasteczko sesji,
- `WORKER_TOKEN` — losowy sekret app ↔ worker,
- `TUNNEL_TOKEN` — token tunelu (krok 4),
- opcjonalnie `COOKIES_FILE` — patrz komentarz w `.env.example`, jeśli
  YouTube blokuje pobieranie ("Sign in to confirm you're not a bot"),
- opcjonalnie `FILE_TTL_SEC` (domyślnie `1800` = 30 min) — po tylu
  sekundach worker kasuje z dysku plik, którego nikt nie odebrał.

## 4. Cloudflare Tunnel + subdomena

1. Cloudflare Dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → wybierz **Cloudflared**.
2. Skopiuj **token** (linia `cloudflared service install <TOKEN>`) do `.env` jako `TUNNEL_TOKEN`.
3. W zakładce **Public Hostname** dodaj:
   - Subdomain: wymyślona nazwa podstrony (np. `yt`), Domain: Twoja domena,
   - Service: `HTTP` → `app:3000`.
4. Zapisz — DNS (rekord CNAME) utworzy się automatycznie.

## 5. Start

```sh
docker compose up -d --build
docker compose logs -f app worker   # obserwuj start (Ctrl+C aby wyjść)
```

Weryfikacja:

```sh
curl -s http://127.0.0.1:3000/api/health          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/   # 302 (redirect → /login, bez sesji)
curl -s http://127.0.0.1:3000/api/auth/session    # {"authenticated":false,"user":null,"users":[...]}
```

Następnie otwórz `https://<twoja-subdomena>` — zobaczysz ekran logowania
(kafelek na każde skonfigurowane konto), a po wybraniu profilu i podaniu
hasła — aplikację.

## 6. Aktualizacja

```sh
git pull
docker compose up -d --build
docker compose restart cloudflared
```

Restart `cloudflared` na końcu jest istotny: `--build` podmienia kontener `app`
na nowy (nowy adres IP w sieci Dockera), a długo działający `cloudflared`
czasem zostaje z nieaktualnym wpisem w DNS Dockera i przestaje trafiać pod
`http://app:3000` (`dial tcp: lookup app on 127.0.0.11:53: server misbehaving`
w `docker compose logs cloudflared`). Restart każe mu rozwiązać `app` na nowo.

## 7. Diagnostyka

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 worker
ls -la downloads/                 # powinno być prawie zawsze puste — patrz niżej
```

## 8. Sprzątanie `downloads/`

Od wersji z automatycznym kasowaniem plików po pobraniu, `./downloads/`
powinno w praktyce świecić pustką — plik trafia tam tylko na czas trwania
transferu do przeglądarki i jest kasowany zaraz po jego zakończeniu
(nieodebrane znikają same po `FILE_TTL_SEC`). Jeśli katalog zdążył się
zapełnić przed tą zmianą (albo z jobów przerwanych w trakcie — `*.part`),
posprzątaj go ręcznie jednorazowo:

```sh
rm -f ~/yt-viewer-redesign/downloads/*
```

Bezpieczne — katalog służy wyłącznie jako tymczasowy bufor workera, appka
sama go nigdzie indziej nie odczytuje.

## Uwagi bezpieczeństwa

- Serwis jest publicznie osiągalny pod subdomeną — ekran logowania (3 konta,
  sesja w podpisanym ciasteczku `HttpOnly`) jest pierwszą linią obrony;
  użyj silnych haseł. Logowanie ma prosty rate-limit (5 prób / 5 min na konto).
- Worker akceptuje wyłącznie żądania z `WORKER_TOKEN`; port 8081 nie jest
  publikowany na hoście.
- Limity: `MAX_CONCURRENT_JOBS`, `MAX_PLAYLIST_ITEMS`, `MAX_DURATION_SEC`
  ograniczają nadużycia (konfiguracja w `.env`).
- Jeśli pobieranie kończy się błędem YouTube o weryfikacji bota, ustaw
  `COOKIES_FILE` (patrz `.env.example`) — worker przekazuje ten plik do
  `yt-dlp --cookies`, dokładnie jak w referencyjnym skrypcie Pythonowym.
- Rozważ dodatkowo Cloudflare Access (Zero Trust) przed subdomeną, jeśli
  serwis ma być prywatny.

## Rozwój lokalny (bez Dockera)

```sh
bun install
bun run dev          # aplikacja na :8080; gateway /api/public/* działa w dev
cd worker && bun install && WORKER_TOKEN=dev bun run src/index.ts   # worker :8081
```

Poza Dockerem worker potrzebuje na hoście `yt-dlp`, `ffmpeg` **i `deno`**
(`brew install yt-dlp ffmpeg deno` na macOS) — yt-dlp używa deno automatycznie
do deszyfrowania sygnatur YouTube; bez tego pobieranie kończy się
`HTTP Error 403: Forbidden`. W obrazie Dockera workera jest to już wbudowane.

W dev ustaw `WORKER_URL=http://127.0.0.1:8081` i `WORKER_TOKEN=dev` dla procesu
dev serwera (np. w `.env.local` — Vite wczyta automatycznie). Żeby przetestować
ekran logowania lokalnie, dopisz też `SESSION_SECRET` oraz co najmniej jedno
`AUTH_USER_1` / `AUTH_PASSWORD_SHA256_1` (bez tego `/api/auth/session` zwróci
pustą listę userów i profile picker będzie pusty) — `/` i `/login` są chronione
w `vite dev` tak samo jak w produkcji (patrz `plugins/downloader-gateway-dev.ts`).
