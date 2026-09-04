// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QueueList } from "./QueueList";
import type { DownloadJob } from "./types";

function job(overrides: Partial<DownloadJob>): DownloadJob {
  return {
    id: "job-1",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Never Gonna Give You Up",
    format: "mp4",
    quality: "720p",
    status: "downloading",
    progress: 42,
    ...overrides,
  };
}

describe("QueueList", () => {
  it("pokazuje pusty stan bez zadań", () => {
    render(<QueueList jobs={[]} />);
    expect(screen.getByText("Kolejka jest pusta")).toBeInTheDocument();
  });

  it("renderuje tytuł, format/jakość i status zadania", () => {
    render(<QueueList jobs={[job({})]} />);
    expect(screen.getByText("Never Gonna Give You Up")).toBeInTheDocument();
    expect(screen.getByText(/mp4 · 720p/)).toBeInTheDocument();
  });

  it("licznik aktywnych liczy tylko downloading/resolving", () => {
    render(
      <QueueList
        jobs={[
          job({ id: "a", status: "downloading" }),
          job({ id: "b", status: "done" }),
          job({ id: "c", status: "resolving" }),
        ]}
      />,
    );
    expect(screen.getByText(/Kolejka · 3 · 2 aktywne/)).toBeInTheDocument();
  });

  it("przycisk Anuluj woła onCancel z id zadania aktywnego", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<QueueList jobs={[job({ status: "downloading" })]} onCancel={onCancel} />);

    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(onCancel).toHaveBeenCalledWith("job-1");
  });

  it("przycisk Ponów widoczny tylko dla zadań z błędem i woła onRetry", async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <QueueList
        jobs={[job({ status: "error", error: "coś poszło nie tak" })]}
        onRetry={onRetry}
      />,
    );

    const retryButton = screen.getByRole("button", { name: "Ponów" });
    await user.click(retryButton);
    expect(onRetry).toHaveBeenCalledWith("job-1");
  });

  it("brak przycisku Anuluj dla zadania zakończonego", () => {
    render(<QueueList jobs={[job({ status: "done" })]} />);
    expect(screen.queryByRole("button", { name: "Anuluj" })).not.toBeInTheDocument();
  });

  it("wyczyść woła onClearFinished", async () => {
    const onClearFinished = vi.fn();
    const user = userEvent.setup();
    render(<QueueList jobs={[job({})]} onClearFinished={onClearFinished} />);
    await user.click(screen.getByRole("button", { name: "wyczyść" }));
    expect(onClearFinished).toHaveBeenCalled();
  });
});
