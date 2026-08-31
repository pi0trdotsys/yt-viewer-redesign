# Wdrożenie na Ubuntu Server (Docker + Cloudflare Tunnel)

Architektura: `docker-compose.yml` uruchamia trzy usługi:

| Usługa        | Rola                                                                  | Port                   |
| ------------- | --------------------------------------------------------------------- | ---------------------- |
| `app`         | Aplikacja TanStack Start (SSR + Basic Auth + gateway `/api/public/*`) | 3000 (tylko localhost) |
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
openssl rand -hex 32            # → WORKER_TOKEN
echo -n "TwojeHaslo" | sha256sum  # → AUTH_PASSWORD_SHA256 (bez spacji z echo -n)
nano .env
```

Uzupełnij w `.env`:

- `AUTH_USER` — login do okna Basic Auth,
- `AUTH_PASSWORD_SHA256` — sha256 hasła (lowercase hex),
- `WORKER_TOKEN` — losowy sekret,
- `TUNNEL_TOKEN` — token tunelu (krok 4).

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
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/   # 401 (bez hasła)
curl -s -u piotr:TwojeHaslo -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/  # 200
```

Następnie otwórz `https://<twoja-subdomena>` — przeglądarka pokaże okno logowania
(Basic Auth), a po zalogowaniu aplikację.

## 6. Aktualizacja

```sh
git pull
docker compose up -d --build
```

## 7. Diagnostyka

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 worker
ls -la downloads/                 # pliki z ukończonych pobrań
```

## Uwagi bezpieczeństwa

- Serwis jest publicznie osiągalny pod subdomeną — Basic Auth jest pierwszą
  linią obrony; użyj silnego hasła.
- Worker akceptuje wyłącznie żądania z `WORKER_TOKEN`; port 8081 nie jest
  publikowany na hoście.
- Limity: `MAX_CONCURRENT_JOBS`, `MAX_PLAYLIST_ITEMS`, `MAX_DURATION_SEC`
  ograniczają nadużycia (konfiguracja w `.env`).
- Rozważ dodatkowo Cloudflare Access (Zero Trust) przed subdomeną, jeśli
  serwis ma być prywatny.

## Rozwój lokalny (bez Dockera)

```sh
bun install
bun run dev          # aplikacja na :8080; gateway /api/public/* działa w dev
cd worker && bun install && WORKER_TOKEN=dev bun run src/index.ts   # worker :8081
```

W dev ustaw `WORKER_URL=http://127.0.0.1:8081` i `WORKER_TOKEN=dev` dla procesu
dev serwera (np. w `.env.local` — Vite wczyta automatycznie).
