// The Competitors page (src/pages/CompetitorReview.tsx): findings of the QA
// bug hunt of 22 Nov 2026 (P20-1 to P20-4).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { db, resetDb, fakeSupabase, mountAt, comp, handle } from "./competitorReviewFake";

vi.mock("@/integrations/supabase/client", () => ({ supabase: fakeSupabase }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canRunAnalysis: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
import CompetitorReview from "@/pages/CompetitorReview";

afterEach(cleanup);

// P20-1: opened from the run page's "Open this selection" (?set=<confirmed>),
// Re-identify made a new draft the page never showed.
describe("Re-identify on a page opened on a set", () => {
  const setUp = () => {
    resetDb({
      clients: [{ id: "client", name: "Client" }],
      competitor_sets: [{ id: "old", client_id: "client", status: "confirmed", created_at: "2026-10-01", confirmed_at: "2026-10-01" }],
      competitors: ["a", "b", "c"].map((id, i) => comp(id, "old", { is_selected: true, selected_rank: i + 1 })),
      competitor_handles: ["a", "b", "c"].map(handle),
    });
    db.invoke = async (name) => {
      if (name === "identify-competitors") {
        db.tables.competitor_sets.unshift({ id: "new", client_id: "client", status: "draft", created_at: "2026-11-22" });
        const fresh = ["x", "y", "z"].map((id) => comp(id, "new", { profile_detection: null }));
        db.tables.competitors.push(...fresh);
        return { data: { set_id: "new", competitors: fresh }, error: null };
      }
      return { data: { results: [{ status: "not_found", detected: [] }] }, error: null };
    };
  };

  it("shows the new draft", async () => {
    setUp();
    mountAt(CompetitorReview, "/clients/client/competitive?set=old");
    fireEvent.click(await screen.findByRole("button", { name: "Re-identify (new draft)" }));
    fireEvent.click(screen.getByRole("button", { name: "Propose competitors" }));
    expect(await screen.findByText("Company x")).toBeInTheDocument();
    expect(screen.queryByText("Company a")).toBeNull();
  });

  it("shows the new draft without ?set too", async () => {
    setUp();
    mountAt(CompetitorReview, "/clients/client/competitive");
    fireEvent.click(await screen.findByRole("button", { name: "Re-identify (new draft)" }));
    fireEvent.click(screen.getByRole("button", { name: "Propose competitors" }));
    expect(await screen.findByText("Company x")).toBeInTheDocument();
  });
});

// P20-2: a second Select pressed before the list re-read got the same rank,
// and Confirm was then refused with no change on screen.
describe("Select and Confirm top 3", () => {
  const base = (selected: Array<number | null>) => ({
    clients: [{ id: "client", name: "Client" }],
    competitor_sets: [{ id: "draft", client_id: "client", status: "draft", created_at: "2026-11-01" }],
    competitors: ["a", "b", "c"].map((id, i) => comp(id, "draft", selected[i] ? { is_selected: true, selected_rank: selected[i] } : {})),
    competitor_handles: ["a", "b", "c"].map(handle),
  });

  it("gives the second Select pressed before the list re-reads rank 2, not rank 1 again", async () => {
    resetDb(base([null, null, null]));
    mountAt(CompetitorReview, "/clients/client/competitive");
    const [a, b] = await screen.findAllByRole("button", { name: "Select" });
    let open: () => void = () => {};
    db.gate = (t) => (t === "competitors" ? new Promise<void>((r) => (open = r)) : null); // the re-read is slow
    fireEvent.click(a);
    await waitFor(() => expect(db.writes).toHaveLength(1));
    await waitFor(() => expect(b).toBeEnabled());
    fireEvent.click(b);
    await waitFor(() => expect(db.writes).toHaveLength(2));
    open();
    expect(db.writes.map((w) => w.value.selected_rank)).toEqual([1, 2]);
  });

  it("says the selection is not confirmed yet when confirm-competitor-set refuses it", async () => {
    resetDb(base([1, 1, 2]));
    db.invoke = async (name) => name === "confirm-competitor-set"
      ? { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status: 422 } } }
      : { data: null, error: null };
    mountAt(CompetitorReview, "/clients/client/competitive");
    const confirm = await screen.findByRole("button", { name: /Confirm top 3/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(db.calls.filter((c) => c.name === "confirm-competitor-set")).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirm top 3/ })).toBeEnabled());
    expect(screen.queryAllByRole("status").some((s) => /confirm/i.test(s.textContent || ""))).toBe(true);
  });
});

// P20-3: a refused import was reported only behind the still-open dialog.
describe("Import from RivalIQ", () => {
  it("tells the person in the import dialog that the landscape was not imported", async () => {
    resetDb({
      clients: [{ id: "client", name: "Client" }],
      competitor_sets: [{ id: "s", client_id: "client", status: "confirmed", created_at: "2026-10-01", confirmed_at: "2026-10-01" }],
      competitors: ["a", "b", "c"].map((id, i) => comp(id, "s", { is_selected: true, selected_rank: i + 1 })),
      competitor_handles: ["a", "b", "c"].map(handle),
    });
    db.invoke = async (_name, body) => body.mode === "list"
      ? { data: { landscapes: [{ id: "L1", name: "Mine", is_match: true, client_company_id: "cc", companies: [{ id: "cc", name: "Client" }, { id: "r1", name: "Rival" }] }] }, error: null }
      : { data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: { status: 422 } } };
    mountAt(CompetitorReview, "/clients/client/competitive");
    fireEvent.click(await screen.findByRole("button", { name: /Import from RivalIQ/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show landscapes" }));
    fireEvent.click(await screen.findByRole("button", { name: /Import 1/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Import as a draft" }));
    await waitFor(() => expect(db.calls.filter((c) => c.mode === "import")).toHaveLength(1));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Import 1/ })).toBeEnabled());
    expect(within(dialog).queryByText(/not been imported/)).not.toBeNull();
  });
});

// P20-4: a failed saved-profiles read said "Loading saved profiles…" for good.
describe("a saved-profiles read that failed", () => {
  it("does not keep saying 'Loading saved profiles…', and reads again", async () => {
    resetDb({
      clients: [{ id: "client", name: "Client" }],
      competitor_sets: [{ id: "d", client_id: "client", status: "draft", created_at: "2026-11-01" }],
      competitors: ["a", "b", "c"].map((id) => comp(id, "d", { profile_detection: null })),
      competitor_handles: [],
    });
    db.fail = { competitor_handles: { code: "PGRST002", message: "Could not query the database" } };
    mountAt(CompetitorReview, "/clients/client/competitive");
    await screen.findByText("Company a");
    await new Promise((r) => setTimeout(r, 300));
    expect(db.calls).toHaveLength(0); // no lookup on a read that did not answer
    expect(screen.queryAllByText("Loading saved profiles…")).toHaveLength(0);
  });
});
