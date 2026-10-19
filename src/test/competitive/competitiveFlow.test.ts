import { describe, expect, it } from "vitest";
import { CHOSEN_AUTOMATICALLY, describeReport, describeSelection, describeTracking, pickRunSelection, competitiveRecovery, stateLine, type SetRow } from "@/lib/competitiveFlow";

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
    expect(describeSelection(sets).detail).toMatch(/newer draft is open/i);
  });

  it("reports no draft conflict when the newest set is the confirmed one", () => {
    const sets = [set({ id: "a", status: "confirmed", created_at: "2026-09-10", confirmed_at: "2026-09-10", confirmed_by: "user-1" })];
    expect(pickRunSelection(sets).newerDraft).toBeNull();
    expect(describeSelection(sets)).toMatchObject({ ready: true, headline: "Three competitors confirmed" });
  });

  it("says a set the lifecycle confirmed was chosen automatically", () => {
    const sets = [set({ id: "a", status: "confirmed", created_at: "2026-10-19", confirmed_at: "2026-10-19", confirmed_by: null })];
    expect(describeSelection(sets).headline).toBe(CHOSEN_AUTOMATICALLY);
    expect(CHOSEN_AUTOMATICALLY).toBe("Chosen automatically: the three closest competitors with a website.");
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
  it("states tracking as a fact: since when, or nothing while the lifecycle connects it", () => {
    expect(describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01" }))).toEqual({ headline: "", ready: false });
    const since = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909", tracked_since: "2026-09-23T12:44:47Z" }));
    expect(since).toEqual({ headline: "Tracked since Sep 23, 2026", ready: true });
    expect(describeTracking(set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "612909" })).headline).toBe("Tracked in RivalIQ");
  });

  it("says nothing about a landscape that has gone; the lifecycle sets it up again", () => {
    const gone = describeTracking(set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "612909",
      tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "612909", message: "gone", checked_at: "2026-10-01T07:00:00Z" } }));
    expect(gone).toEqual({ headline: "", ready: false });
    // A check about an earlier landscape says nothing about this one.
    const stale = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909",
      tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "500", message: null, checked_at: "2026-10-01T07:00:00Z" } }));
    expect(stale.ready).toBe(true);
  });

  it("never asks anyone to connect or confirm anything", () => {
    const states = [describeTracking(null), describeTracking(set({ id: "d", status: "draft", created_at: "2026-09-01" })),
      describeSelection([]), describeSelection([set({ id: "d", status: "draft", created_at: "2026-09-01" })])];
    for (const st of states) expect(stateLine(st)).not.toMatch(/connect|confirm a|set up|first/i);
    expect(describeTracking(null).ready).toBe(false);
  });
});

describe("describeReport", () => {
  it("keeps the report outcome apart from selection and tracking", () => {
    expect(describeReport(null).headline).toMatch(/No report run yet/i);
    expect(describeReport({ id: "r", status: "running", created_at: "x" }).ready).toBe(false);
    expect(describeReport({ id: "r", status: "complete", created_at: "x" }).ready).toBe(true);
    // A run that did not finish is made again and never shown.
    expect(describeReport({ id: "r", status: "failed", created_at: "x" }).headline).not.toMatch(/fail|did not finish/i);
  });
});

it('distinguishes pending collection from a completed collection with no returned posts, and says it is being redone', () => {
 const empty={aggregates:{companies:[{name:'Client',post_count:0,observed_post_count:0}]}};
 expect(competitiveRecovery({...empty,provider_status:2}).detail).toMatch(/not finished collecting/);
 expect(competitiveRecovery({...empty,provider_status:1}).detail).toMatch(/no posts/);
 expect(competitiveRecovery(empty).detail).toContain('does not establish');
 for (const data of [{...empty,provider_status:2},empty,{quality_check:{reasons:['Different provider totals']}}]) expect(competitiveRecovery(data).title).toBe('Being redone');
 // Facts only: nothing asks anyone to retry or review, and the checks' own reasons stay out.
 for (const data of [{...empty,provider_status:2},empty,{quality_check:{reasons:['Different provider totals']}}]) for (const staff of [true,false]) {
   const r=competitiveRecovery(data,staff);
   expect(r.detail).not.toMatch(/retry|review|choose another|Different provider totals/i);
 }
 expect(competitiveRecovery({...empty,provider_status:2},false).detail).not.toMatch(/RivalIQ/);
});

describe("stateLine", () => {
  it("ends the headline as a sentence before the detail", () => {
    expect(stateLine({ headline: "Tracked since Sep 23, 2026", detail: "Reports use this selection.", ready: true })).toBe("Tracked since Sep 23, 2026. Reports use this selection.");
    expect(stateLine({ headline: "Done.", ready: true })).toBe("Done.");
    expect(stateLine({ headline: "", detail: "Only detail.", ready: true })).toBe("Only detail.");
  });
});
