# Worker yt-dlp: Bun (usługa HTTP) + ffmpeg + yt-dlp (standalone binary).
FROM oven/bun:1-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp \
 && chmod +x /usr/local/bin/yt-dlp \
 && apt-get purge -y curl \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=8081 \
    DOWNLOAD_DIR=/data

RUN mkdir -p /data
VOLUME /data

EXPOSE 8081

# Best-effort aktualizacja yt-dlp przy starcie (YouTube często zmienia API),
# potem właściwa usługa.
CMD ["sh", "-c", "yt-dlp -U >/dev/null 2>&1 || true; bun run src/index.ts"]