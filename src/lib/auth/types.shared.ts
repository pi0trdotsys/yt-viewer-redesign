import { z } from "zod";

/**
 * Współdzielone DTO logowania (klient/serwer). Bez sufiksu `.server` —
 * bezpieczne do importu przez komponenty (np. `src/routes/login.tsx`).
 */

export const USER_ACCENTS = ["primary", "navy"] as const;
export type UserAccent = (typeof USER_ACCENTS)[number];

export const ACCOUNT_ROLES = ["admin", "user"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export interface PublicUser {
  id: string;
  name: string;
  /** Opcjonalny emoji zamiast inicjałów na kafelku logowania. */
  avatar?: string | undefined;
  /** Wariant koloru kafelka/avatara — domyślnie "primary". */
  accent: UserAccent;
}

/** `PublicUser` zalogowanego usera + rola — rola NIE wychodzi w publicznej
 *  liście kont na ekranie logowania (`SessionResponseDto.users`), tylko
 *  jako `SessionResponseDto.user` po zalogowaniu (kontrakt panelu admina). */
export interface SessionUser extends PublicUser {
  role: AccountRole;
}

export const loginInputSchema = z.object({
  userId: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface SessionResponseDto {
  authenticated: boolean;
  user: SessionUser | null;
  users: PublicUser[];
}

// --- panel admina -----------------------------------------------------------

/** `id` = login. Świadomie restrykcyjne (bez spacji/unicode) — to jest
 *  identyfikator konta, nie nazwa wyświetlana. */
export const accountIdSchema = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-z0-9_-]+$/, "Dozwolone: litery a-z, cyfry, myślnik, podkreślenie");

export const accountNameSchema = z.string().min(1).max(64);
export const accountAvatarSchema = z.string().max(8);
export const accountPasswordSchema = z.string().min(8).max(256);

export interface AdminUserDto {
  id: string;
  name: string;
  avatar?: string | undefined;
  accent: UserAccent;
  role: AccountRole;
  createdAt: number;
  updatedAt: number;
}

export const createAccountInputSchema = z.object({
  id: accountIdSchema,
  name: accountNameSchema,
  password: accountPasswordSchema,
  avatar: accountAvatarSchema.optional(),
  accent: z.enum(USER_ACCENTS).optional(),
  role: z.enum(ACCOUNT_ROLES).optional(),
});
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

export const updateAccountInputSchema = z.object({
  name: accountNameSchema.optional(),
  avatar: accountAvatarSchema.optional(),
  accent: z.enum(USER_ACCENTS).optional(),
  role: z.enum(ACCOUNT_ROLES).optional(),
});
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>;

export const setPasswordInputSchema = z.object({ password: accountPasswordSchema });
export type SetPasswordInput = z.infer<typeof setPasswordInputSchema>;

export const changeOwnPasswordInputSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: accountPasswordSchema,
});
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInputSchema>;
