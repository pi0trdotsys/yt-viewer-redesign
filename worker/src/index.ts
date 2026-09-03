import { createHandler } from "./app";

/**
 * Worker yt-dlp — osobna usługa HTTP (Model A, kontrakt §1.1). Cały routing
 * żyje w `app.ts` (`createHandler`), żeby dało się go testować bez sieci;
 * ten plik tylko czyta env i odpala `Bun.serve`.
 */

// Siatka bezpieczeństwa: worker zarządza kilkoma procesami (yt-dlp/ffmpeg)
// naraz per pobranie, połączonymi pipe'ami — nieobsłużony błąd na jednym z
// nich (np. EPIPE po rozłączeniu klienta) bez tego zabijałby CAŁY worker,
// czyli wszystkie aktywne pobrania innych userów, nie tylko ten jeden.
process.on("uncaughtException", (error) => {
  console.error("[worker] uncaughtException (ignorowany, worker działa dalej):", error);
});
process.on("unhandledRejection", (reason) => {
  console.error("[worker] unhandledRejection (ignorowany, worker działa dalej):", reason);
});

const PORT = Number(process.env["PORT"] ?? "8081");
const SECRET = process.env["WORKER_TOKEN"] ?? "";

if (!SECRET) {
  console.error("[worker] WORKER_TOKEN is required — refusing to start.");
  process.exit(1);
}

Bun.serve({
  port: PORT,
  fetch: createHandler(SECRET),
  // Domyślne 10 s starcza na zwykłe API, ale nie na start pobrania: dwa
  // równoległe yt-dlp muszą ruszyć i zacząć pisać, zanim w ogóle spawnujemy
  // ffmpeg (patrz `waitForFirstProgress` w streams.ts) — to samo w sobie
  // bywa wolniejsze niż 10 s przy słabszym połączeniu z YouTube.
  idleTimeout: 120,
});

console.log(`[worker] listening on :${PORT}`);
