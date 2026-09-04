import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Loader2, Plus, ShieldCheck, Trash2, UserCog } from "lucide-react";

import { accentClasses, initials } from "@/lib/auth/avatar";
import {
  USER_ACCENTS,
  type AccountRole,
  type AdminUserDto,
  type UserAccent,
} from "@/lib/auth/types.shared";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "YT Downloader — panel admina" },
      { name: "description", content: "Zarządzanie kontami: loginy, hasła, avatary, role." },
    ],
  }),
  component: Admin,
});

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `Żądanie nie powiodło się (${res.status})`;
  } catch {
    return `Żądanie nie powiodło się (${res.status})`;
  }
}

function Admin() {
  const [users, setUsers] = useState<AdminUserDto[] | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    void fetch("/api/admin/users")
      .then(async (res) => {
        if (!res.ok) {
          toast.error(await readError(res));
          setUsers([]);
          return;
        }
        const data = (await res.json()) as { users: AdminUserDto[] };
        setUsers(data.users);
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div aria-hidden className="grid-field pointer-events-none absolute inset-0 opacity-40" />
      <div className="halo relative mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-14">
        <header className="mb-8 flex items-center gap-3 sm:mb-10">
          <Link
            to="/"
            aria-label="Wróć do pobierania"
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <ArrowLeft className="size-4" strokeWidth={1.75} />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-lg leading-none tracking-tight text-foreground/90 sm:text-xl">
              Panel admina
            </h1>
            <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-muted-foreground sm:text-[11px]">
              Konta · loginy · hasła · avatary
            </p>
          </div>
        </header>

        <div className="rise space-y-6">
          <CreateAccountCard onCreated={reload} />

          <section className="space-y-3">
            <p className="label-mono">Konta · {users?.length ?? "…"}</p>
            {loading ? (
              <div className="flex items-center justify-center rounded-2xl border border-dashed border-border/60 py-12 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" strokeWidth={1.75} />
              </div>
            ) : !users || users.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-4 py-8 text-center font-mono text-[11px] tracking-[0.14em] uppercase text-muted-foreground/70">
                Brak kont
              </p>
            ) : (
              <ul className="space-y-3">
                {users.map((u) => (
                  <AccountCard
                    key={u.id}
                    user={u}
                    onChanged={reload}
                    adminCount={adminCount(users)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function adminCount(users: AdminUserDto[]): number {
  return users.filter((u) => u.role === "admin").length;
}

// --- tworzenie konta ---------------------------------------------------------

function CreateAccountCard({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [avatar, setAvatar] = useState("");
  const [accent, setAccent] = useState<UserAccent>("primary");
  const [role, setRole] = useState<AccountRole>("user");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setId("");
    setName("");
    setPassword("");
    setAvatar("");
    setAccent("primary");
    setRole("user");
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    void fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name, password, avatar: avatar || undefined, accent, role }),
    })
      .then(async (res) => {
        if (!res.ok) {
          toast.error(await readError(res));
          return;
        }
        toast.success(`Konto „${name}” utworzone`);
        reset();
        setOpen(false);
        onCreated();
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setBusy(false));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-4 py-3.5 font-mono text-[11px] tracking-[0.18em] uppercase text-muted-foreground transition-colors duration-300 hover:border-primary/40 hover:text-foreground"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        Nowe konto
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="glass relative space-y-4 rounded-2xl p-5 sm:p-6">
      <span aria-hidden className="absolute inset-x-6 top-0 hairline-top opacity-60" />
      <p className="label-mono">Nowe konto</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Login (id)">
          <input
            required
            value={id}
            onChange={(e) => setId(e.target.value.toLowerCase())}
            pattern="[a-z0-9_-]{2,32}"
            placeholder="np. dorota"
            className="field-input"
          />
        </Field>
        <Field label="Nazwa wyświetlana">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="np. Dorota"
            className="field-input"
          />
        </Field>
        <Field label="Hasło (min. 8 znaków)">
          <input
            required
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="field-input"
          />
        </Field>
        <Field label="Avatar (emoji, opcjonalnie)">
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            maxLength={8}
            placeholder="🦊"
            className="field-input"
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <AccentPicker value={accent} onChange={setAccent} />
        <label className="flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-muted-foreground">
          <input
            type="checkbox"
            checked={role === "admin"}
            onChange={(e) => setRole(e.target.checked ? "admin" : "user")}
            className="size-3.5 accent-primary"
          />
          Rola admina
        </label>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="submit"
          disabled={busy}
          className="flex min-h-10 items-center gap-2 rounded-lg border border-primary/40 bg-primary/8 px-4 py-2 font-mono text-[11px] tracking-[0.16em] uppercase text-foreground transition-colors duration-300 hover:border-primary/70 hover:bg-primary/16 disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <Plus className="size-3.5" strokeWidth={1.75} />
          )}
          Utwórz
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="min-h-10 rounded-lg border border-border/60 px-4 py-2 font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground transition-colors duration-300 hover:border-foreground/30 hover:text-foreground"
        >
          Anuluj
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="label-mono block text-[10px]">{label}</span>
      {children}
    </label>
  );
}

function AccentPicker({
  value,
  onChange,
}: {
  value: UserAccent;
  onChange: (v: UserAccent) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="label-mono text-[10px]">Kolor</span>
      <div className="flex gap-1.5">
        {USER_ACCENTS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            aria-label={a}
            aria-pressed={value === a}
            className={`size-6 rounded-full border transition-all duration-300 ${accentClasses(a).avatar} ${
              value === a
                ? "scale-110 ring-2 ring-offset-2 ring-offset-background ring-primary/50"
                : "opacity-60"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// --- karta istniejącego konta -----------------------------------------------

function AccountCard({
  user,
  onChanged,
  adminCount,
}: {
  user: AdminUserDto;
  onChanged: () => void;
  adminCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState(user.avatar ?? "");
  const [accent, setAccent] = useState<UserAccent>(user.accent);
  const [role, setRole] = useState<AccountRole>(user.role);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const isLastAdmin = user.role === "admin" && adminCount <= 1;

  const saveEdits = () => {
    setBusy(true);
    void fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, avatar: avatar || undefined, accent, role }),
    })
      .then(async (res) => {
        if (!res.ok) {
          toast.error(await readError(res));
          return;
        }
        toast.success("Zapisano zmiany");
        setEditing(false);
        onChanged();
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setBusy(false));
  };

  const submitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    void fetch(`/api/admin/users/${encodeURIComponent(user.id)}/password`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: newPassword }),
    })
      .then(async (res) => {
        if (!res.ok) {
          toast.error(await readError(res));
          return;
        }
        toast.success(`Nowe hasło ustawione dla „${user.name}”`);
        setNewPassword("");
        setPasswordOpen(false);
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setBusy(false));
  };

  const remove = () => {
    if (
      !window.confirm(`Usunąć konto „${user.name}” (${user.id})? Tej operacji nie da się cofnąć.`)
    ) {
      return;
    }
    setBusy(true);
    void fetch(`/api/admin/users/${encodeURIComponent(user.id)}`, { method: "DELETE" })
      .then(async (res) => {
        if (!res.ok) {
          toast.error(await readError(res));
          return;
        }
        toast.success(`Konto „${user.name}” usunięte`);
        onChanged();
      })
      .catch(() => toast.error("Nie udało się połączyć z serwerem"))
      .finally(() => setBusy(false));
  };

  return (
    <li className="glass relative space-y-4 rounded-2xl p-5 sm:p-6">
      <span aria-hidden className="absolute inset-x-6 top-0 hairline-top opacity-60" />

      <div className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full border font-display text-sm ${accentClasses(user.accent).avatar}`}
        >
          {user.avatar ?? initials(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
            {user.role === "admin" ? (
              <span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/8 px-2 py-0.5 font-mono text-[9px] tracking-[0.14em] text-primary uppercase">
                <ShieldCheck className="size-2.5" strokeWidth={2} />
                admin
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            @{user.id}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Edytuj konto"
            title="Edytuj"
            onClick={() => setEditing((v) => !v)}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-300 hover:bg-surface-2/60 hover:text-foreground"
          >
            <UserCog className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Ustaw nowe hasło"
            title="Ustaw nowe hasło"
            onClick={() => setPasswordOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-300 hover:bg-surface-2/60 hover:text-primary"
          >
            <KeyRound className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Usuń konto"
            title={isLastAdmin ? "Nie można usunąć ostatniego admina" : "Usuń konto"}
            disabled={isLastAdmin || busy}
            onClick={remove}
            className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors duration-300 hover:bg-surface-2/60 hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-4 border-t border-border/50 pt-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nazwa wyświetlana">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field-input"
              />
            </Field>
            <Field label="Avatar (emoji)">
              <input
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                maxLength={8}
                className="field-input"
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <AccentPicker value={accent} onChange={setAccent} />
            <label
              className={`flex items-center gap-2 font-mono text-[11px] tracking-[0.1em] text-muted-foreground ${isLastAdmin ? "opacity-40" : ""}`}
            >
              <input
                type="checkbox"
                checked={role === "admin"}
                disabled={isLastAdmin}
                onChange={(e) => setRole(e.target.checked ? "admin" : "user")}
                className="size-3.5 accent-primary"
              />
              Rola admina
              {isLastAdmin ? " (ostatni admin)" : ""}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={saveEdits}
              disabled={busy}
              className="flex min-h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary/8 px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] uppercase text-foreground transition-colors duration-300 hover:border-primary/70 hover:bg-primary/16 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
              Zapisz
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="min-h-9 rounded-lg border border-border/60 px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground transition-colors duration-300 hover:border-foreground/30 hover:text-foreground"
            >
              Anuluj
            </button>
          </div>
        </div>
      ) : null}

      {passwordOpen ? (
        <form onSubmit={submitPassword} className="space-y-3 border-t border-border/50 pt-4">
          <Field label="Nowe hasło (min. 8 znaków)">
            <input
              required
              type="password"
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              className="field-input"
            />
          </Field>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex min-h-9 items-center gap-2 rounded-lg border border-primary/40 bg-primary/8 px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] uppercase text-foreground transition-colors duration-300 hover:border-primary/70 hover:bg-primary/16 disabled:opacity-40"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} /> : null}
              Ustaw hasło
            </button>
            <button
              type="button"
              onClick={() => {
                setNewPassword("");
                setPasswordOpen(false);
              }}
              className="min-h-9 rounded-lg border border-border/60 px-4 py-1.5 font-mono text-[11px] tracking-[0.16em] uppercase text-muted-foreground transition-colors duration-300 hover:border-foreground/30 hover:text-foreground"
            >
              Anuluj
            </button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
