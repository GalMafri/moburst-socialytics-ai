// QA 22 Nov 2026 (P08-04): the Design tab's Download. When fetching the design fails (network,
// storage CORS, an expired URL) the handler throws out of try/finally: the
// spinner clears and the button looks exactly as before. No file, no state line.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PostDesign } from "@/components/reports/calendar/PostDesign";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: async () => ({ data: {}, error: null }) } } }));
afterEach(cleanup);

describe("P08-04 Download when the design cannot be fetched", () => {
  it("tells the person the file was not downloaded", async () => {
    const rejections: unknown[] = [];
    const onRej = (e: PromiseRejectionEvent) => { rejections.push(e.reason); e.preventDefault(); };
    window.addEventListener("unhandledrejection", onRej);
    process.on("unhandledRejection", (r) => rejections.push(r));
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    render(<PostDesign versions={[{ iterationId: "it1", urls: ["https://storage.example/d.png"], isSelected: true, createdAt: "2026-11-03T10:00:00Z" }]}
      preparing={null} isStaff aspect="aspect-[4/5]" filenameStub="design-instagram" onCreate={() => {}} creating={false}
      onUse={() => {}} usingId={null} onFeedback={async () => true} />);
    const before = document.body.textContent;
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false));
    await new Promise((r) => setTimeout(r, 50));
    expect(document.body.textContent, `nothing changed on screen; handler rejected with: ${String(rejections[0])}`).not.toBe(before);
    expect(screen.getByRole("status")).toHaveTextContent("Not downloaded yet.");
  });

  it("does not save a refused answer as the picture", async () => {
    const created: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Forbidden</html>", { status: 403 })));
    const createObjectURL = vi.fn((b: unknown) => { created.push(b); return "blob:x"; });
    URL.createObjectURL = createObjectURL as never;
    URL.revokeObjectURL = () => {};
    render(<PostDesign versions={[{ iterationId: "it1", urls: ["https://storage.example/d.png"], isSelected: true, createdAt: "2026-11-03T10:00:00Z" }]}
      preparing={null} isStaff aspect="aspect-[4/5]" filenameStub="design-instagram" onCreate={() => {}} creating={false}
      onUse={() => {}} usingId={null} onFeedback={async () => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(await screen.findByText("Not downloaded yet.")).toBeInTheDocument();
    expect(created).toHaveLength(0);
  });
});
