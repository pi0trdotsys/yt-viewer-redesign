import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { DownloadJob } from "@/components/downloader/types";
import type { SessionResponseDto } from "@/lib/auth/types.shared";

import { getDownloaderEngine, type HttpDownloaderEngine } from "./engine";
import { parseYoutubeUrl } from "./validate";
import type { StartInput } from "./types.shared";

/**
 * Hook spinający silnik ze stanem React (kontrakt §2: `useDownloader`).
 *
 * Persystencja (§10): kolejka w `localStorage`, klucz per-użytkownik
 * (`ytdl.queue.v1.<userId>`) — inaczej po zalogowaniu innym kontem w tej
 * samej przeglądarce widać historię/kolejkę poprzedniego usera. Odczyt
 * wyłącznie w `useEffect` (hydration-safe), walidacja w `engine.importDtos`
 * (niezgodne rekordy odrzucane), limit 100 rekordów historii.
 *
 * Model strumieniowy nie ma serwerowej kolejki do zsynchronizowania — po
 * restarcie karty historia to wyłącznie to, co przetrwało w localStorage
 * (bilety są jednorazowe i krótkotrwałe, nie da się ich "doczytać" z workera).
 */

const LEGACY_SHARED_KEY = "ytdl.queue.v1";

function storageKey(userId: string): string {
  return `${LEGACY_SHARED_KEY}.${userId}`;
}

function loadPersisted(engine: HttpDownloaderEngine, userId: string): void {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    engine.importDtos(parsed);
  } catch {
    // uszkodzony zapis — ignoruj (§10: nie rzucaj wyjątkiem)
  }
}

function persist(engine: HttpDownloaderEngine, userId: string): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(engine.exportDtos()));
  } catch {
    // brak miejsca / tryb prywatny — persystencja jest best-effort
  }
}

export function useDownloader() {
  const engine = useMemo(() => getDownloaderEngine(), []);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const hydratedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);

  // Hydration-safe: najpierw kim jesteśmy (klucz localStorage per-user),
  // dopiero potem odczyt persystencji (§10).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    // Jednorazowe sprzątanie starego, współdzielonego między kontami klucza
    // (przed wprowadzeniem izolacji per-user) — nie ma już czytelnika.
    try {
      window.localStorage.removeItem(LEGACY_SHARED_KEY);
    } catch {
      // ignoruj — best-effort
    }

    void fetch("/api/auth/session")
      .then((res) => res.json() as Promise<SessionResponseDto>)
      .then((data) => {
        userIdRef.current = data.user?.id ?? null;
        if (userIdRef.current) loadPersisted(engine, userIdRef.current);
        setJobs(engine.snapshot());
      })
      .catch(() => undefined);
  }, [engine]);

  // Subskrypcja emisji silnika + persystencja po każdej zmianie.
  useEffect(() => {
    const unsubscribe = engine.subscribe((job) => {
      setJobs((prev) => {
        const index = prev.findIndex((j) => j.id === job.id);
        if (index === -1) return [...prev, job];
        const next = [...prev];
        next[index] = job;
        return next;
      });
      if (userIdRef.current) persist(engine, userIdRef.current);
    });
    return unsubscribe;
  }, [engine]);

  const start = useCallback(
    async (input: StartInput): Promise<void> => {
      if (!parseYoutubeUrl(input.url)) {
        toast.error("Nieprawidłowy adres YouTube");
        return;
      }
      try {
        await engine.start(input);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Nie udało się rozpocząć pobierania");
      }
    },
    [engine],
  );

  const cancel = useCallback(
    async (jobId: string): Promise<void> => {
      await engine.cancel(jobId);
    },
    [engine],
  );

  const retry = useCallback(
    async (jobId: string): Promise<void> => {
      try {
        await engine.retry(jobId);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Nie udało się ponowić zadania");
      }
    },
    [engine],
  );

  const clearFinished = useCallback(() => {
    engine.clearFinished();
    setJobs((prev) =>
      prev.filter((j) => j.status !== "done" && j.status !== "error" && j.status !== "canceled"),
    );
    if (userIdRef.current) persist(engine, userIdRef.current);
  }, [engine]);

  return { jobs, start, cancel, retry, clearFinished };
}
