import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/telemetry", () => ({ track }));
import { ErrorBoundary } from "@/components/ErrorBoundary";

afterEach(() => cleanup());

function Boom(): JSX.Element {
  throw new Error("boom secret detail");
}

describe("ErrorBoundary", () => {
  it("shows a calm screen with a way back and never the thrown text", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/boom/i)).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/Something went wrong|Try again|failed|could not/i);
    const back = screen.getByRole("link", { name: /dashboard/i });
    expect(back.getAttribute("href")).toBe("/");
    // The team still gets the error in the console.
    expect(log.mock.calls.flat().some((a) => String(a).includes("boom secret detail") || (a as Error)?.message === "boom secret detail")).toBe(true);
    log.mockRestore();
  });

  it("tells the team once per error and does not draw the page again itself", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    track.mockClear();
    render(
      <MemoryRouter>
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(track.mock.calls.filter((c) => c[0] === "render_error")).toHaveLength(1);
  });

  it("leaves the fallback when the person goes to another route", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <MemoryRouter initialEntries={["/bad"]}>
        <Link to="/good">go good</Link>
        <ErrorBoundary>
          <Routes>
            <Route path="/bad" element={<Boom />} />
            <Route path="/good" element={<p>good page</p>} />
          </Routes>
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.queryByText("good page")).toBeNull();
    fireEvent.click(screen.getByText("go good"));
    expect(screen.getByText("good page")).toBeTruthy();
  });

  it("is mounted in App.tsx around the telemetry, the return link and the routes and the dev preview route is gone", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/<BrowserRouter>\s*<ErrorBoundary>[\s\S]*<Telemetry \/>[\s\S]*<ReturnTo \/>[\s\S]*<Routes>[\s\S]*<\/Routes>[\s\S]*<\/ErrorBoundary>/);
    expect(app).not.toMatch(/\/dev\//);
    expect(app).not.toMatch(/DevCalendarPreview/);
  });
});
