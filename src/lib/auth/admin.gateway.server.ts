import { errorMessage, errorStatus } from "./http-error";
import { getSessionUser } from "./session.server";
import {
  createAccount,
  deleteAccount,
  listAdminUsers,
  setAccountPassword,
  updateAccount,
} from "./users.store.server";
import {
  createAccountInputSchema,
  setPasswordInputSchema,
  updateAccountInputSchema,
} from "./types.shared";

/**
 * `/api/admin/*` — CRUD kont dla panelu `/admin` (kontrakt: plan "Konta i
 * panel admina"). Każdy endpoint wymaga sesji z rolą `admin` — sprawdzane tu
 * (analogicznie do `handleDownloaderApi`), nie tylko w `guard.server.ts`
 * (który chroni wyłącznie stronę `/admin`, nie samo API).
 */

const PREFIX = "/api/admin/";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function handleAdminApi(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(PREFIX)) return null;

  const user = await getSessionUser(request);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);
  if (user.role !== "admin") return json({ error: "FORBIDDEN" }, 403);

  try {
    if (pathname === "/api/admin/users" && request.method === "GET") {
      return json({ users: await listAdminUsers() });
    }

    if (pathname === "/api/admin/users" && request.method === "POST") {
      const parsed = createAccountInputSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        return json({ error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" }, 400);
      }
      const created = await createAccount(parsed.data);
      return json({ user: created }, 201);
    }

    const userMatch = /^\/api\/admin\/users\/([a-z0-9_-]{2,32})$/.exec(pathname);
    if (userMatch && request.method === "PATCH") {
      const id = userMatch[1]!;
      const parsed = updateAccountInputSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        return json({ error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" }, 400);
      }
      const updated = await updateAccount(id, parsed.data);
      return json({ user: updated });
    }
    if (userMatch && request.method === "DELETE") {
      const id = userMatch[1]!;
      if (id === user.id) {
        return json({ error: "Nie można usunąć własnego konta, na którym jesteś zalogowany" }, 400);
      }
      await deleteAccount(id);
      return json({ ok: true });
    }

    const passwordMatch = /^\/api\/admin\/users\/([a-z0-9_-]{2,32})\/password$/.exec(pathname);
    if (passwordMatch && request.method === "PUT") {
      const id = passwordMatch[1]!;
      const parsed = setPasswordInputSchema.safeParse(await readJson(request));
      if (!parsed.success) {
        return json(
          { error: parsed.error.issues[0]?.message ?? "Hasło musi mieć min. 8 znaków" },
          400,
        );
      }
      await setAccountPassword(id, parsed.data.password);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: errorMessage(error, "Błąd wewnętrzny") }, errorStatus(error));
  }
}
