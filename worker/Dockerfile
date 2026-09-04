# Worker yt-dlp: Bun (usługa HTTP) + ffmpeg + yt-dlp (standalone binary) + deno.
# YouTube wymaga teraz wykonania JS przy deszyfrowaniu sygnatur (n-param);
# bez obsługiwanego runtime'u JS yt-dlp dostaje "HTTP Error 403: Forbidden"
# (yt-dlp używa deno automatycznie, jeśli jest w $PATH — bez dodatkowych flag).
FROM oven/bun:1-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl unzip \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && DENO_ARCH="$(dpkg --print-architecture | sed -e 's/amd64/x86_64/' -e 's/arm64/aarch64/')" \
 && curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_ARCH}-unknown-linux-gnu.zip" \
      -o /tmp/deno.zip \
 && unzip -q -o /tmp/deno.zip -d /usr/local/bin \
 && chmod +x /usr/local/bin/deno \
 && rm /tmp/deno.zip \
 && apt-get purge -y curl unzip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=8081

# /data istnieje wyłącznie pod opcjonalny cookies.txt (COOKIES_FILE) — pliki
# wynikowe nigdy nie trafiają na dysk, strumień leci prosto do przeglądarki.
RUN mkdir -p /data
VOLUME /data

EXPOSE 8081

# Best-effort aktualizacja yt-dlp przy starcie (YouTube często zmienia API),
# potem właściwa usługa.
CMD ["sh", "-c", "yt-dlp -U >/dev/null 2>&1 || true; bun run src/index.ts"]