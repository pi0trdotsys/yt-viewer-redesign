import { Readable } from "node:stream";

import type { Plugin } from "vite";

import { handleDownloaderApi } from "../src/lib/downloader/gateway.server";
import { handleAuthApi } from "../src/lib/auth/gateway.server";
import { handleAdminApi } from "../src/lib/auth/admin.gateway.server";
import { guardPageRequest } from "../src/lib/auth/guard.server";

/**
 * Dev-only middleware obsługujące gateway /api/public/*, /api/auth/*,
 * /api/admin/* oraz ochronę stron `/`, `/admin` i `/login` (produkcja
 * obsługuje to samo w src/server.ts — Nitro node-server entry nie jest
 * używany pod `vite dev`). Dzięki temu cały flow logowania, pobierania i
 * panelu admina da się przetestować bez Dockera, o ile worker (WORKER_URL)
 * jest osiągalny.
 */
export function downloaderGatewayDevPlugin(): Plugin {
  return {
    name: "downloader-gateway-dev",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? "";
        const method = req.method ?? "GET";
        const isApi = url.startsWith("/api/");
        const isGuardedPage =
          (method === "GET" || method === "HEAD") &&
          (url === "/" || url === "/admin" || url.startsWith("/login"));

        if (!isApi && !isGuardedPage) {
          next();
          return;
        }

        const host = req.headers.host ?? "localhost";
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === "string") headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(", "));
        }

        const init: RequestInit = { method, headers };
        if (isApi && method !== "GET" && method !== "HEAD") {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 64 * 1024) {
              res.writeHead(413, { "content-type": "application/json" });
              res.end(JSON.stringify({ error: "PAYLOAD_TOO_LARGE" }));
              return;
            }
            chunks.push(chunk as Buffer);
          }
          if (chunks.length > 0) init.body = Buffer.concat(chunks);
        }

        try {
          const request = new Request(`http://${host}${url}`, init);

          if (isGuardedPage) {
            const guardResponse = await guardPageRequest(request);
            if (guardResponse) {
              res.writeHead(
                guardResponse.status,
                Object.fromEntries(guardResponse.headers.entries()),
              );
              res.end();
              return;
            }
            next();
            return;
          }

          const response =
            (await handleAuthApi(request)) ??
            (await handleAdminApi(request)) ??
            (await handleDownloaderApi(request));
          if (!response) {
            next();
            return;
          }
          res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
          if (response.body) {
            Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
          } else {
            res.end();
          }
        } catch (error) {
          console.error("[gateway-dev]", error);
          res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
          res.end("gateway error");
        }
      });
    },
  };
}
