import { z } from "zod";

/**
 * Współdzielone DTO logowania (klient/serwer). Bez sufiksu `.server` —
 * bezpieczne do importu przez komponenty (np. `src/routes/login.tsx`).
 */

export interface PublicUser {
  id: string;
  name: string;
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
