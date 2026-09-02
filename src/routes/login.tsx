import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, LockKeyhole } from "lucide-react";

import type { PublicUser, SessionResponseDto } from "@/lib/auth/types.shared";
import { accentClasses, initials } from "@/lib/auth/avatar";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "YT Downloader — logowanie" },
      { name: "description", content: "Logowanie do prywatnej usługi pobierania z YouTube." },
    ],
  }),
  component: Login,
});

function Login() {
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [selected, setSelected] = useState<PublicUser | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Hydration-safe: userzy i stan sesji pobierani po zamontowaniu (spójne
  // z wzorcem `loadPersisted` w src/lib/downloader/useDownloader.ts).
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session")
      .then((res) => res.json() as Promise<SessionResponseDto>)
      .then((data) => {
        if (cancelled) return;
        if (data.authenticated) {
          window.location.assign("/");
          return;
        }
        setUsers(data.users);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selected) passwordRef.current?.focus();
  }, [selected]);

  const selectUser = (user: PublicUser) => {
    setSelected(user);
    setPassword("");
    setError(null);
  };

  const goBack = () => {
    setSelected(null);
    setPassword("");
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    void fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: selected.id, password }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setError(data.error ?? "Nie udało się zalogować");
          setBusy(false);
          return;
        }
        window.location.assign("/");
      })
      .catch(() => {
        setError("Przerwane połączenie — spróbuj ponownie");
        setBusy(false);
      });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-40" />
      <div className="halo relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12 sm:px-6">
        <header className="mb-10 flex items-center justify-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/10 font-mono text-[11px] tracking-tight text-primary">
            YT
          </span>
          <h1 className="font-display text-lg leading-none tracking-tight sm:text-xl">
            Downloader
          </h1>
        </header>

        <div className="glass rise space-y-8 rounded-2xl p-6 sm:p-8">
          {selected === null ? (
            <>
              <div className="space-y-1 text-center">
                <p className="label-mono">Dostęp prywatny</p>
                <p className="text-sm text-muted-foreground">Wybierz profil, aby się zalogować</p>
              </div>

              {users === null ? (
                <p className="label-mono text-center">Ładowanie…</p>
              ) : users.length === 0 ? (
                <p className="text-center text-sm text-destructive">
                  Brak skonfigurowanych użytkowników — sprawdź zmienne AUTH_USER_1..3
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:gap-4">
                  {users.map((user) => {
                    const accent = accentClasses(user.accent);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => selectUser(user)}
                        className={`group flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-surface-2/30 px-1.5 py-3 transition-all duration-300 hover:bg-primary/8 focus-visible:outline-none sm:gap-2.5 sm:px-2 sm:py-4 ${accent.tile}`}
                      >
                        <span
                          className={`grid size-12 shrink-0 place-items-center rounded-full border font-display text-base transition-transform duration-300 group-hover:scale-105 sm:size-14 sm:text-lg ${accent.avatar}`}
                        >
                          {user.avatar ?? initials(user.name)}
                        </span>
                        <span className="w-full truncate text-center text-xs text-foreground sm:text-sm">
                          {user.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={goBack}
                  aria-label="Wróć do wyboru profilu"
                  className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <ArrowLeft className="size-4" strokeWidth={1.75} />
                </button>
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-full border font-display text-sm ${accentClasses(selected.accent).avatar}`}
                >
                  {selected.avatar ?? initials(selected.name)}
                </span>
                <span className="truncate font-display text-base tracking-tight">
                  {selected.name}
                </span>
              </div>

              <div className="space-y-3">
                <span className="label-mono">Hasło</span>
                <div
                  className={`group relative flex items-center gap-3 rounded-xl border bg-surface-2/30 px-4 py-4 transition-all duration-300 ${
                    error
                      ? "border-destructive/60"
                      : "border-border/70 focus-within:border-primary/40"
                  }`}
                >
                  <LockKeyhole
                    className={`size-4 shrink-0 ${error ? "text-destructive" : "text-primary/80"}`}
                    strokeWidth={1.5}
                  />
                  <input
                    ref={passwordRef}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    autoComplete="current-password"
                    aria-label="Hasło"
                    className="w-full min-w-0 bg-transparent font-mono text-sm tracking-tight text-foreground outline-none disabled:opacity-50"
                  />
                </div>
                {error ? (
                  <p className="flex items-center gap-1.5 text-xs text-destructive" role="alert">
                    <AlertTriangle className="size-3.5 shrink-0" strokeWidth={1.75} />
                    {error}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={busy || password.length === 0}
                className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl border border-primary/40 bg-primary/8 px-6 py-4 font-mono text-[12px] tracking-[0.32em] uppercase text-foreground transition-all duration-500 hover:border-primary/70 hover:bg-primary/16 hover:shadow-[var(--glow-primary)] disabled:cursor-not-allowed disabled:opacity-35"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-primary/15 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                />
                {busy ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ArrowRight
                    className="size-4 text-primary transition-transform duration-500 group-hover:translate-x-0.5"
                    strokeWidth={1.75}
                  />
                )}
                Zaloguj
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
