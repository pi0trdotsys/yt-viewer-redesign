import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// `globals: false` w vitest.config.ts (importy jawne, jak w resztcie repo)
// — @testing-library/react rejestruje auto-cleanup tylko gdy `afterEach`
// jest globalne, więc bez tego DOM z poprzedniego testu (.test.tsx) zostaje
// zamontowany przy kolejnym, dając np. zduplikowane role/przyciski.
afterEach(() => {
  cleanup();
});

/**
 * Znane pułapki (kontrakt testów, patrz plan): brak `EventSource` w Node —
 * `engine.ts` (klient SSE) potrzebuje minimalnej atrapy, żeby dało się w
 * ogóle zaimportować moduł w testach node-environment bez jsdom.
 */
if (typeof globalThis.EventSource === "undefined") {
  class EventSourceStub {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    onerror: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: unknown) => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 0;
    constructor(
      public url: string,
      _init?: unknown,
    ) {}
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {
      this.readyState = 2;
    }
  }
  // @ts-expect-error — atrapa nie implementuje pełnego interfejsu DOM
  globalThis.EventSource = EventSourceStub;
}
