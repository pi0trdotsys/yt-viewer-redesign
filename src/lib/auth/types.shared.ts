import { z } from "zod";

/**
 * Współdzielone DTO logowania (klient/serwer). Bez sufiksu `.server` —
 * bezpieczne do importu przez komponenty (np. `src/routes/login.tsx`).
 */

export const USER_ACCENTS = ["primary", "navy"] as const;
export type UserAccent = (typeof USER_ACCENTS)[number];

export interface PublicUser {
  id: string;
  name: string;
  /** Opcjonalny emoji zamiast inicjałów na kafelku logowania (AUTH_AVATAR_n). */
  avatar?: string | undefined;
  /** Wariant koloru kafelka/avatara (AUTH_ACCENT_n) — domyślnie "primary". */
  accent: UserAccent;
}

export const loginInputSchema = z.object({
  userId: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof loginInputSchema>;

export interface SessionResponseDto {
  authenticated: boolean;
  user: PublicUser | null;
  users: PublicUser[];
}
