import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Osobny config od `vite.config.ts` — ten ostatni owija
 * `@lovable.dev/vite-tanstack-config`, który nie przyjmuje klucza `test`
 * (patrz komentarz na górze `vite.config.ts`). Testy `.test.ts(x)` leżą
 * kolokowane przy źródłach (nie w osobnym katalogu `tests/`).
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    // Domyślnie Node (szybsze, wystarcza dla logiki serwerowej/czystych
    // funkcji); pliki komponentów dostają jsdom przez docblock
    // `// @vitest-environment jsdom` na górze pliku (Vitest 5 usunął
    // environmentMatchGlobs — to jest teraz zalecany sposób per-plik).
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    restoreMocks: true,
  },
});
