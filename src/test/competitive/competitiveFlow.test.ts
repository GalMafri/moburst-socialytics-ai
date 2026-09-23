import { describe, expect, it } from "vitest";
import { describeReport, describeSelection, describeTracking, pickRunSelection, plainCompetitiveError, type SetRow } from "@/lib/competitiveFlow";

const set = (o: Partial<SetRow> & { id: string; status: string; created_at: string }): SetRow => o as SetRow;

describe("pickRunSelection", () => {
  it('uses confirmation date rather than creation date, matching the backend', () => {
    const result = pickRunSelection([
      set({id:'newer-created',status:'confirmed',created_at:'2026-09-20',confirmed_at:'2026-09-20'}),
      set({id:'recently-reconfirmed',status:'complete',created_at:'2026-09-01',confirmed_at:'2026-09-23'}),
    ]);
    expect(result.runnable?.id).toBe('recently-reconfirmed');
  });
  it("runs the newest confirmed set and names a newer draft instead of hiding it", () => {
    const sets = [
      set({ id: "draft", status: "draft", created_at: "2026-09-10" }),
      set({ id: "old", status: "complete", created_at: "2026-08-01", confirmed_at: "2026-08-01" }),
    ];
    const { latest, runnable, newerDraft } = pickRunSelection(sets);
    expect(latest?.id).toBe("draft");
    expect(runnable?.id).toBe("old");
    expect(newerDraft?.id).toBe("draft");
    expect(describeSelection(sets).headline).toMatch(/older confirmed selection/i);
  });

  it("reports no draft conflict when the newest set is the confirmed one", () => {
    const sets = [set({ id: "a", status: "confirmed", created_at: "2026-09-10", confirmed_at: "2026-09-10" })];
    expect(pickRunSelection(sets).newerDraft).toBeNull();
    expect(describeSelection(sets).ready).toBe(true);
  });

  it("treats a failed set as still confirmed, and a draft-only client as not ready", () => {
    expect(pickRunSelection([set({ id: "f", status: "failed", created_at: "2026-09-01" })]).runnable?.id).toBe("f");
    const drafts = [set({ id: "d", status: "draft", created_at: "2026-09-01" })];
    expect(pickRunSelection(drafts).runnable).toBeNull();
    expect(describeSelection(drafts).ready).toBe(false);
    expect(describeSelection([]).headline).toMatch(/No competitors chosen/i);
  });
});

describe("describeTracking", () => {
  it("separates a confirmed selection from connected tracking", () => {
    const unconnected = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01" }));
    expect(unconnected.ready).toBe(false);
    expect(unconnected.headline).toMatch(/not connected/i);
    const connected = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909" }));
    expect(connected.ready).toBe(true);
    // A created landscape must never be presented as historical data.
    expect(connected.detail).toMatch(/little history/i);
    expect(connected.detail).not.toMatch(/history is available/i);
  });

  it("does not offer tracking for a draft-only client", () => {
    expect(describeTracking(set({ id: "d", status: "draft", created_at: "2026-09-01" })).ready).toBe(false);
    expect(describeTracking(null).ready).toBe(false);
  });
});

describe("describeReport", () => {
  it("keeps the report outcome apart from selection and tracking", () => {
    expect(describeReport(null).headline).toMatch(/No report run yet/i);
    expect(describeReport({ id: "r", status: "running", created_at: "x" }).ready).toBe(false);
    expect(describeReport({ id: "r", status: "complete", created_at: "x" }).ready).toBe(true);
    expect(describeReport({ id: "r", status: "failed", created_at: "x" }).headline).toMatch(/did not finish/i);
  });
});

describe("plainCompetitiveError", () => {
  it("explains the RivalIQ rate limit that failed one of two simultaneous runs", () => {
    const msg = plainCompetitiveError("List RivalIQ Landscapes: HTTP 429");
    expect(msg).toMatch(/one request at a time/i);
    expect(msg).toMatch(/100 an hour/i);
    expect(msg).toMatch(/90-minute/i);
    expect(msg).not.toMatch(/nothing was saved|few minutes|usually means/i);
    expect(plainCompetitiveError("List RivalIQ Landscapes failed. Try spacing your requests out using the batching settings under 'Options'")).toBe(msg);
    expect(msg).not.toMatch(/429/);
  });

  it("points a missing-tracking failure at the setup step", () => {
    expect(plainCompetitiveError("RIVALIQ_CLIENT_NOT_TRACKED")).toMatch(/Connect tracking/i);
  });
  it("does not mistake a provider or website 401 for an expired portal session", () => {
    expect(plainCompetitiveError("Website returned HTTP 401")).toBe("Website returned HTTP 401");
    expect(plainCompetitiveError("Provider returned HTTP 403")).toBe("Provider returned HTTP 403");
    expect(plainCompetitiveError("Request timeout")).toMatch(/may still be processing/);
  });

  it("rewrites timeouts and expired sessions, and keeps an already-plain message", () => {
    expect(plainCompetitiveError("The server took too long (over the 150s limit)")).toMatch(/took too long/i);
    expect(plainCompetitiveError("Your session has expired.")).toMatch(/portal/i);
    expect(plainCompetitiveError("Only two competitors have reviewed profiles.")).toBe("Only two competitors have reviewed profiles.");
    expect(plainCompetitiveError("")).toMatch(/did not complete/i);
  });
});
