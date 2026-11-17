import { describe, expect, it } from "vitest";
import { CHOSEN_AUTOMATICALLY, describeAnalysis, describeReport, describeSelection, describeTracking, pickRunSelection, competitiveRecovery, stateLine, type SetRow } from "@/lib/competitiveFlow";

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
  const untracked = set({ id: "a", status: "confirmed", created_at: "2026-09-01" });
  const waiting = (waiting_for: string, extra: Record<string, unknown> = {}) => ({ step: "tracking", status: "waiting", result: { waiting_for, ...extra } });
  const NOT_STARTED = { headline: "Not started yet", ready: false, state: "not_started" };

  it("tracked: says since when", () => {
    const since = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909", tracked_since: "2026-09-23T12:44:47Z" }));
    expect(since).toEqual({ headline: "Tracked since Sep 23, 2026", ready: true, state: "tracked" });
    expect(describeTracking(set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "612909" })).headline).toBe("Tracked in RivalIQ");
    // A set with no link of its own, once the shared decision found one landscape holding the whole selection.
    const found = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01",
      tracking_check: { code: "ok", landscape_id: null, message: null, checked_at: "2026-11-17T07:00:00Z", found_landscape_id: "640" } }));
    expect(found.ready).toBe(true);
  });

  it("untracked: says tracking has not started, never a blank, whatever the screen could read", () => {
    expect(describeTracking(untracked)).toEqual(NOT_STARTED);
    expect(describeTracking(untracked, null)).toEqual(NOT_STARTED);
    // A step that is running, was not finished, or waits for something this screen has no words for.
    for (const step of [{ step: "tracking", status: "running", result: null }, { step: "tracking", status: "failed", result: { waiting_for: "rivaliq_full" } }, waiting("something_new")]) {
      expect(describeTracking(untracked, step)).toEqual(NOT_STARTED);
    }
    // What the earlier check left on a set with no link ("ok" for a landscape tracking the client alone) is not tracking.
    const lax = set({ id: "a", status: "confirmed", created_at: "2026-09-01", tracking_check: { code: "ok", landscape_id: null, message: null, checked_at: "2026-11-16T07:00:00Z" } });
    expect(describeTracking(lax)).toEqual(NOT_STARTED);
  });

  it("waiting: says what tracking waits for, in each state the lifecycle can be in", () => {
    const line = (waiting_for: string, extra: Record<string, unknown> = {}) => stateLine(describeTracking(untracked, waiting(waiting_for, extra)));
    expect(line("rivaliq_full")).toBe("Not started yet. The tracking plan is full. Tracking starts when a place opens.");
    expect(line("client_website")).toBe("Not started yet. Tracking starts once the client's website is found.");
    expect(line("own_site")).toBe("Not started yet. The client's website is a page on another client's site, so tracking starts once the client has a site of its own.");
    expect(line("site_refused", { refused: ["Tailspin Cycles"] })).toBe("Not started yet. The website of Tailspin Cycles does not allow tracking. Tracking starts once a different competitor is chosen.");
    expect(line("site_refused", { refused: ["Tailspin Cycles", "Fabrikam Wheels"] })).toBe("Not started yet. The websites of Tailspin Cycles and Fabrikam Wheels do not allow tracking. Tracking starts once different competitors are chosen.");
    expect(line("site_refused")).toBe("Not started yet. A chosen competitor's website does not allow tracking. Tracking starts once a different competitor is chosen.");
    expect(line("selection")).toBe("Not started yet. Tracking starts once three competitors with websites of their own are chosen.");
    expect(line("analysis_running")).toBe("Not started yet. Tracking starts once the analysis running now is ready.");
    expect(line("in_progress")).toBe("Starting. The competitors are being added to tracking.");
    expect(describeTracking(untracked, waiting("in_progress")).state).toBe("starting");
    for (const state of ["rivaliq_full", "client_website", "own_site", "site_refused", "selection", "analysis_running", "in_progress"]) {
      expect(describeTracking(untracked, waiting(state)).ready).toBe(false);
      expect(line(state)).not.toMatch(/RivalIQ|waiting_for|rivaliq_full|site_refused|landscape|undefined|null/);
    }
  });

  it("selection not covered: tracking is there, but not for this selection; says which company, that tracking stays, and that the analysis waits", () => {
    const linked = (uncovered?: unknown) => set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "501", tracked_since: "2026-09-23T12:44:47Z",
      tracking_check: { code: "RIVALIQ_SELECTION_NOT_COVERED", landscape_id: "501", message: "for the team", checked_at: "2026-11-17T07:00:00Z", ...(uncovered ? { uncovered } : {}) } });
    const one = describeTracking(linked({ client: false, competitors: ["Contoso Rides"] }));
    expect(one).toEqual({
      headline: "Does not cover this selection", ready: false, state: "not_covered",
      detail: "The tracked companies do not include Contoso Rides. The current tracking stays in place, and the analysis waits until the tracked companies match the selection.",
    });
    expect(describeTracking(linked({ client: false, competitors: ["Fabrikam Wheels", "Contoso Rides"] })).detail)
      .toBe("The tracked companies do not include Fabrikam Wheels and Contoso Rides. The current tracking stays in place, and the analysis waits until the tracked companies match the selection.");
    expect(describeTracking(linked({ client: true, competitors: [] })).detail)
      .toBe("The tracked companies do not include the client as one company. The current tracking stays in place, and the analysis waits until the tracked companies match the selection.");
    expect(describeTracking(linked()).detail)
      .toBe("The tracked companies do not match the confirmed competitors. The current tracking stays in place, and the analysis waits until the tracked companies match the selection.");
    // The lifecycle's own step is done for a linked set, so it adds nothing here; and nothing asks anyone to act or names a vendor.
    expect(describeTracking(linked({ client: false, competitors: ["Contoso Rides"] }), { step: "tracking", status: "done", result: {} })).toEqual(one);
    expect(stateLine(one)).not.toMatch(/RivalIQ|landscape|reset|set up|connect|fail|could not|undefined/i);
    expect(describeAnalysis({ headline: "Three competitors confirmed", ready: true }, one)).toEqual({ headline: "Runs once tracking covers this selection", ready: false });
  });

  it("a landscape that has gone is not tracking; the lifecycle starts it again, and only then is that said", () => {
    const gone = describeTracking(set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "612909",
      tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "612909", message: "gone", checked_at: "2026-10-01T07:00:00Z", gone: true } }));
    expect(gone).toEqual({ headline: "Not tracked right now", detail: "Tracking is starting again.", ready: false, state: "gone" });
    expect(describeAnalysis({ headline: "Three competitors confirmed", ready: true }, gone)).toEqual({ headline: "Runs once tracking has started", ready: false });
    // An older record that names no cause: not tracked, and no promise that anything is starting again.
    const old = describeTracking(set({ id: "a", status: "complete", created_at: "2026-09-01", rivaliq_landscape_id: "612909",
      tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "612909", message: "gone", checked_at: "2026-10-01T07:00:00Z" } }));
    expect(old).toEqual({ headline: "Not tracked right now", ready: false, state: "not_tracked" });
    // A check about an earlier landscape says nothing about this one.
    const stale = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909",
      tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "500", message: null, checked_at: "2026-10-01T07:00:00Z", gone: true } }));
    expect(stale.ready).toBe(true);
  });

  it("never asks anyone to connect or confirm anything", () => {
    const states = [describeTracking(null), describeTracking(set({ id: "d", status: "draft", created_at: "2026-09-01" })), describeTracking(untracked),
      describeSelection([]), describeSelection([set({ id: "d", status: "draft", created_at: "2026-09-01" })])];
    for (const st of states) expect(stateLine(st)).not.toMatch(/connect|confirm a|set up|first/i);
    expect(describeTracking(null)).toEqual({ headline: "", ready: false, state: "none" });
    expect(describeTracking(set({ id: "d", status: "draft", created_at: "2026-09-01" }))).toEqual({ headline: "", ready: false, state: "none" });
  });
});

describe("describeAnalysis", () => {
  const chosen = describeSelection([set({ id: "a", status: "confirmed", created_at: "2026-09-01", confirmed_at: "2026-09-02" })]);
  it("tracked: an analysis is ready to run", () => {
    const tracked = describeTracking(set({ id: "a", status: "confirmed", created_at: "2026-09-01", rivaliq_landscape_id: "612909" }));
    expect(describeAnalysis(chosen, tracked)).toEqual({ headline: "Ready to run", ready: false });
  });
  it("untracked or waiting: it runs once tracking has started, and is never offered as ready", () => {
    const untracked = set({ id: "a", status: "confirmed", created_at: "2026-09-01" });
    expect(describeAnalysis(chosen, describeTracking(untracked))).toEqual({ headline: "Runs once tracking has started", ready: false });
    expect(describeAnalysis(chosen, describeTracking(untracked, { step: "tracking", status: "waiting", result: { waiting_for: "rivaliq_full" } }))).toEqual({ headline: "Runs once tracking has started", ready: false });
  });
  it("says nothing before competitors are chosen", () => {
    expect(describeAnalysis(describeSelection([]), describeTracking(null))).toEqual({ headline: "", ready: false });
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

it('says a held analysis is not shared, and nothing about being made again, once no redo can come', () => {
 const held={provider_status:2,aggregates:{companies:[{name:'Client',post_count:0,observed_post_count:0}]}};
 const old=new Date(Date.now()-30*86400000).toISOString();
 const today=new Date().toISOString();
 for (const staff of [true,false]) {
   const gone=competitiveRecovery(held,staff,old);
   expect(gone.title).toBe('Not shared');
   expect(gone.detail).not.toMatch(/once a day|made again|redone/i);
   expect(gone.detail).toMatch(/it is not shared/);
   const coming=competitiveRecovery(held,staff,today);
   expect(coming.title).toBe('Being redone');
   expect(coming.detail).toContain('once a day');
 }
 // The last allowed redo's row, made today, has no redo coming.
 expect(competitiveRecovery(held,true,today,4)).toMatchObject({title:'Not shared'});
 expect(competitiveRecovery(held,true,today,4).detail).not.toMatch(/once a day|made again/);
 expect(competitiveRecovery(held,true,today,3).title).toBe('Being redone');
 expect(competitiveRecovery({aggregates:{companies:[{name:'Client',post_count:0,observed_post_count:0}]}},true,old).detail).not.toContain('once a day');
 expect(competitiveRecovery({quality_check:{reasons:['x']}},true,old).detail).not.toContain('once a day');
});

it('reads the dispatch decision on the held row before any clock', () => {
 const base={provider_status:2,aggregates:{companies:[{name:'Client',post_count:0,observed_post_count:0}]}};
 const old=new Date(Date.now()-30*86400000).toISOString();
 const today=new Date().toISOString();
 const queued=competitiveRecovery({...base,redo:{queued:true,available_at:today,decided_at:old}},false,old,4);
 expect(queued.title).toBe('Being redone');
 expect(queued.detail).toContain('once a day');
 const none=competitiveRecovery({...base,redo:{queued:false,decided_at:today}},false,today,1);
 expect(none.title).toBe('Not shared');
 expect(none.detail).not.toMatch(/once a day|made again/);
});

describe("stateLine", () => {
  it("ends the headline as a sentence before the detail", () => {
    expect(stateLine({ headline: "Tracked since Sep 23, 2026", detail: "Reports use this selection.", ready: true })).toBe("Tracked since Sep 23, 2026. Reports use this selection.");
    expect(stateLine({ headline: "Done.", ready: true })).toBe("Done.");
    expect(stateLine({ headline: "", detail: "Only detail.", ready: true })).toBe("Only detail.");
  });
});
