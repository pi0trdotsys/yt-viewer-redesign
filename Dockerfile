# Aplikacja TanStack Start (Nitro node-server) — build + runtime.
FROM oven/bun:1-slim AS build

WORKDIR /app

COPY package.json bun.lock bunfig.toml ./
COPY src ./src
COPY public ./public
COPY plugins ./plugins
COPY vite.config.ts tsconfig.json components.json eslint.config.js ./

RUN bun install --frozen-lockfile \
 && bun run build

FROM oven/bun:1-slim AS runtime

WORKDIR /app

COPY --from=build /app/.output ./.output

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

# Nitro node-server: uruchamiamy przez bun (kompatybilny z Node API).
CMD ["bun", ".output/server/index.mjs"]