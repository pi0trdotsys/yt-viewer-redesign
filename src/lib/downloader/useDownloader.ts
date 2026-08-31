import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { DownloadJob } from "@/components/downloader/types";

import { getDownloaderEngine, type HttpDownloaderEngine } from "./engine";
import { parseYoutubeUrl } from "./validate";
import type { StartInput } from "./types.shared";

/**
 * Hook spinający silnik ze stanem React (kontrakt §2: `useDownloader`).
 *
 * Persystencja (§10): kolejka w `localStorage` (klucz `ytdl.queue.v1`),
 * odczyt wyłącznie w `useEffect` (hydration-safe), walidacja zodem
 * (niezgodne rekordy odrzucane), limit 100 rekordów historii.
 */

const STORAGE_KEY = "ytdl.queue.v1";
const HISTORY_LIMIT = 100;

function loadPersisted(engine: HttpDownloaderEngine): void {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    engine.importDtos(parsed);
  } catch {
    // uszkodzony zapis — ignoruj (§10: nie rzucaj wyjątkiem)
  }
}

function persist(engine: HttpDownloaderEngine): void {
  try {
    const dtos = engine.exportDtos().slice(-HISTORY_LIMIT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dtos));
  } catch {
    // brak miejsca / tryb prywatny — persystencja jest best-effort
  }
}

export function useDownloader() {
  const engine = useMemo(() => getDownloaderEngine(), []);
  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const hydratedRef = useRef(false);

  // Hydration-safe odczyt persystencji + synchronizacja z serwerem (§10).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    loadPersisted(engine);
    setJobs(engine.snapshot());
    void engine.syncFromServer();
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
      persist(engine);
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
    persist(engine);
  }, [engine]);

  const getDownloadUrl = useCallback(
    (jobId: string): string | null => engine.getDownloadUrl(jobId),
    [engine],
  );

  return { jobs, start, cancel, retry, clearFinished, getDownloadUrl };
}
