// @vitest-environment node
// The one decision: is the confirmed selection tracked? The dispatch's check
// before a run (landscapeCheck.ts resolveSelectionLandscape) and the
// pipeline's landscape step (nodes.ts resolveLandscape) both make it through
// selectionTracking, so on the same client, competitors and link they give
// the same answer. Brands here are invented.
import { describe, expect, it } from "vitest";
import { NEEDS_TRACKING, NO_LANDSCAPES, recordedTracking, SELECTION_FACT_CODES, SELECTION_FACT_MESSAGES, selectionFactIn, selectionTracking, trackedOnRecord, unreadableLandscapes, type SelectedCompany } from "../../../functions/_shared/competitive/selectionTracking";
import { CLIENT_NOT_TRACKED, LANDSCAPE_MISSING, RIVALIQ_UNAVAILABLE, SELECTION_NOT_COVERED, isTrackingProblem, resolveClientLandscape, resolveSelectionLandscape, trackingCheckRecord } from "../../../functions/_shared/competitive/landscapeCheck";
import { resolveLandscape, runConfig } from "../../../functions/_shared/pipelines/competitive/nodes";
import { SelectionFact, StepStop } from "../../../functions/_shared/pipelines/types";

const CLIENT = { name: "Northwind Bikes", website_url: "https://www.northwindbikes.example/" };
const SELECTION: SelectedCompany[] = [
  { name: "Tailspin Cycles", website_url: "https://tailspincycles.example" },
  { name: "Fabrikam Wheels", website_url: "https://fabrikamwheels.example/shop" },
  { name: "Contoso Rides", website_url: "contosorides.example" },
];
const co = (id: number, name: string, url: string) => ({ id, name, url });
const client = co(1, "Northwind Bikes Ltd", "http://northwindbikes.example");
const rivals = [co(2, "Tailspin", "https://tailspincycles.example/"), co(3, "Fabrikam", "https://www.fabrikamwheels.example"), co(4, "Contoso", "https://contosorides.example")];

/** The landscape set up for this selection: the client and its three competitors. */
const OWN = { id: 777, name: "Socialytics - Northwind Bikes - set-1", focusCompanyId: 1, companies: [client, ...rivals] };
/** An older landscape: the client with other companies. The check used to take it for tracking. */
const OLD = { id: 501, name: "TIER 1", focusCompanyId: 1, companies: [client, co(9, "Adventure Works", "https://adventureworks.example"), rivals[0]] };
/** Someone else's shared landscape that happens to hold all four, with another company in focus. */
const SHARED = { id: 640, name: "TIER 2", focusCompanyId: 30, companies: [co(30, "Wide World", "https://wideworld.example"), client, ...rivals] };
const OTHERS = { id: 12, name: "TIER 3", focusCompanyId: 30, companies: [co(30, "Wide World", "https://wideworld.example"), rivals[1]] };

describe("selectionTracking: the confirmed set is tracked, or it is not", () => {
  it("tracked: the set's own linked landscape holds the client and every confirmed competitor exactly once", () => {
    const r = selectionTracking([OLD, OWN], CLIENT, SELECTION, "777");
    expect(r).toMatchObject({ tracked: true, matched_by: "explicit id", landscape: { id: 777 }, client_company: { id: 1 } });
    expect(r.tracked && r.selected_companies.map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it("tracked with no link: one landscape on the account holds the client and every confirmed competitor", () => {
    const r = selectionTracking([OLD, OTHERS, OWN], CLIENT, SELECTION, null);
    expect(r).toMatchObject({ tracked: true, matched_by: "verified client and selected companies", landscape: { id: 777 } });
    // Of two that fit, the one whose focus is the client.
    expect(selectionTracking([SHARED, OWN], CLIENT, SELECTION, "  ")).toMatchObject({ tracked: true, landscape: { id: 777 } });
    expect(selectionTracking([SHARED], CLIENT, SELECTION, undefined)).toMatchObject({ tracked: true, landscape: { id: 640 } });
  });

  it("not tracked: a landscape that tracks the client alone, with other competitors, is not tracking for this selection", () => {
    // The defect: the check before a run accepted this one, and the pipeline then refused it.
    expect(selectionTracking([OLD, OTHERS], CLIENT, SELECTION, null)).toMatchObject({ tracked: false, code: "LANDSCAPE_NOT_FOUND" });
    expect(resolveClientLandscape([OLD, OTHERS], CLIENT, null).ok).toBe(true);
    expect(resolveSelectionLandscape([OLD, OTHERS], CLIENT, SELECTION, null)).toMatchObject({ ok: false, code: CLIENT_NOT_TRACKED, landscapeId: null });
  });

  it("not tracked: the linked landscape is gone, tracks the client twice or not at all, or misses a confirmed competitor", () => {
    expect(selectionTracking([OLD], CLIENT, SELECTION, "777")).toMatchObject({ tracked: false, code: "LANDSCAPE_NOT_FOUND" });
    const doubled = { ...OWN, companies: [...OWN.companies, co(8, "Northwind Bikes", "https://northwindbikes.example")] };
    expect(selectionTracking([doubled], CLIENT, SELECTION, "777")).toMatchObject({ tracked: false, code: "CLIENT_IDENTITY_UNVERIFIED" });
    expect(selectionTracking([OTHERS], CLIENT, SELECTION, "12")).toMatchObject({ tracked: false, code: "CLIENT_IDENTITY_UNVERIFIED" });
    expect(selectionTracking([OLD], CLIENT, SELECTION, "501")).toMatchObject({ tracked: false, code: "TRACKING_SELECTION_MISMATCH", uncovered: { client: false, competitors: ["Fabrikam Wheels", "Contoso Rides"] } });
    // A competitor tracked twice is not tracked exactly once.
    const twice = { ...OWN, companies: [...OWN.companies, co(11, "Tailspin again", "https://tailspincycles.example")] };
    expect(selectionTracking([twice], CLIENT, SELECTION, "777")).toMatchObject({ tracked: false, code: "TRACKING_SELECTION_MISMATCH" });
    // A saved provider id does not override a conflicting reviewed website.
    const saved = [{ ...SELECTION[0], rivaliq_company_id: 99 }, ...SELECTION.slice(1)];
    expect(selectionTracking([OWN], CLIENT, saved, "777")).toMatchObject({ tracked: false, code: "TRACKING_SELECTION_MISMATCH" });
    expect(selectionTracking([OWN], CLIENT, [{ ...SELECTION[0], rivaliq_company_id: 2 }, ...SELECTION.slice(1)], "777").tracked).toBe(true);
  });

  it("an answer that cannot carry a decision is unreadable, never a fact: empty, malformed, or missing the companies the decision rests on", () => {
    const unreadable = (landscapes: unknown, linked: unknown) => {
      const r = selectionTracking(landscapes, CLIENT, SELECTION, linked);
      expect(r, JSON.stringify(landscapes)).toMatchObject({ tracked: false, unreadable: true });
      expect(r).not.toHaveProperty("code");
      return r.tracked === false ? r.message : "";
    };
    // No list at all, or an empty one: the account always has landscapes.
    for (const none of [[], null, undefined, {}, "landscapes", { landscapes: [OWN] }]) {
      for (const linked of [null, "777"]) expect(unreadable(none, linked)).toBe(NO_LANDSCAPES);
    }
    // An entry that is not a landscape with an id.
    for (const bad of [[OWN, null], [OWN, "x"], [OWN, { name: "no id" }], [OWN, { id: "  " }], [[OWN]]]) {
      for (const linked of [null, "999"]) unreadable(bad, linked);
      expect(unreadableLandscapes(bad)).not.toBeNull();
    }
    expect(unreadableLandscapes([OLD, OWN])).toBeNull();
    // The linked landscape is listed without its companies: it cannot be said to cover the selection or not.
    for (const companies of [undefined, null, "none", {}, [client, null], [client, { name: "no id" }]]) {
      unreadable([{ ...OWN, companies }, OLD], "777");
    }
    // With no link, "no landscape fits" rests on every landscape: one listed without its companies leaves it unsaid.
    unreadable([OLD, { id: 12, name: "TIER 3" }], null);
    unreadable([OLD, { ...OTHERS, companies: null }], null);
  });

  it("a readable part of the answer still carries its own decision", () => {
    // The linked landscape is readable, so another entry without companies changes nothing about it.
    expect(selectionTracking([OWN, { id: 12, name: "TIER 3" }], CLIENT, SELECTION, "777").tracked).toBe(true);
    expect(selectionTracking([OLD, { id: 12, name: "TIER 3" }], CLIENT, SELECTION, "501")).toMatchObject({ tracked: false, code: "TRACKING_SELECTION_MISMATCH" });
    // The link names a landscape that is not in a list of landscapes with ids: gone, whatever the others list.
    expect(selectionTracking([OLD, { id: 12, name: "TIER 3" }], CLIENT, SELECTION, "999")).toMatchObject({ tracked: false, code: "LANDSCAPE_NOT_FOUND" });
    // With no link, a landscape that fits is found among the readable ones.
    expect(selectionTracking([OWN, { id: 12, name: "TIER 3" }], CLIENT, SELECTION, null)).toMatchObject({ tracked: true, landscape: { id: 777 } });
    // A linked landscape with no companies yet is readable: it holds neither the client nor the selection.
    expect(selectionTracking([{ ...OWN, companies: [] }], CLIENT, SELECTION, "777")).toMatchObject({ tracked: false, code: "CLIENT_IDENTITY_UNVERIFIED", uncovered: { client: true } });
  });

  it("matches a client with no website by its name, and never by part of a name", () => {
    const named = { name: "Northwind Bikes Ltd." };
    expect(selectionTracking([{ ...OWN, companies: [co(1, "Northwind Bikes", ""), ...rivals] }], named, SELECTION, null).tracked).toBe(true);
    expect(selectionTracking([{ ...OWN, companies: [co(1, "Northwind", ""), ...rivals] }], named, SELECTION, null).tracked).toBe(false);
  });

  it("every fact's message leads with its code, and the fact is read back from a run's outcome by the decision's own words", () => {
    for (const [landscapes, linked] of [[[OLD], null], [[OTHERS], "12"], [[OLD], "501"], [[OLD], "999"]] as const) {
      const r = selectionTracking(landscapes as never, CLIENT, SELECTION, linked);
      expect(r.tracked).toBe(false);
      if (r.tracked === false && "code" in r) {
        expect(r.message).toBe(SELECTION_FACT_MESSAGES[r.code]);
        expect(r.message.startsWith(`${r.code}: `)).toBe(true);
        expect(selectionFactIn(r.message)).toBe(r.code);
        expect(selectionFactIn(`the in-app pipeline stopped (Step landscape did not finish in 5 tries: ${r.message})`)).toBe(r.code);
      }
    }
    expect(SELECTION_FACT_CODES).toEqual(["LANDSCAPE_NOT_FOUND", "CLIENT_IDENTITY_UNVERIFIED", "TRACKING_SELECTION_MISMATCH"]);
    // Not a fact: another fault, an empty answer, or another step's message that only begins with one of the codes.
    for (const other of [
      "Step posts did not finish in 5 tries: RivalIQ answered 502", "", null, undefined, 404, NO_LANDSCAPES, `Step landscape did not finish in 5 tries: ${NO_LANDSCAPES}`,
      "Step aggregate did not finish in 5 tries: CLIENT_IDENTITY_UNVERIFIED: the RivalIQ landscape must track exactly one company matching Northwind Bikes. A focus company is not automatically the client.",
      "LANDSCAPE_NOT_FOUND", "TRACKING_SELECTION_MISMATCH: something else",
    ]) expect(selectionFactIn(other), String(other)).toBeNull();
  });
});

describe("the check before a run and the pipeline's landscape step cannot disagree", () => {
  const body = (linked: string | null, selection = SELECTION) => ({
    report_id: "r1", client_id: "c1", client_name: CLIENT.name, website_url: CLIENT.website_url, set_id: "set-1",
    rivaliq_landscape_id: linked || undefined, competitors: selection, date_range_start: "2026-10-01", date_range_end: "2026-10-31",
  });
  const accounts: Array<[string, unknown[]]> = [
    ["no landscapes", []], ["the old landscape only", [OLD]], ["others only", [OTHERS]], ["its own landscape", [OLD, OWN]],
    ["a shared one that fits", [SHARED, OTHERS]], ["its own and a shared one", [SHARED, OWN, OLD]],
  ];
  const selections: Array<[string, SelectedCompany[]]> = [
    ["the confirmed three", SELECTION],
    ["a changed selection", [SELECTION[0], SELECTION[1], { name: "Proseware Gear", website_url: "https://prosewaregear.example" }]],
    ["no competitors", []],
  ];
  for (const [account, landscapes] of accounts) {
    for (const linked of [null, "777", "501", "640", "999"]) {
      for (const [which, selection] of selections) {
        it(`${account}, linked to ${linked ?? "nothing"}, ${which}`, () => {
          const check = resolveSelectionLandscape(landscapes as never, CLIENT, selection, linked);
          let step: ReturnType<typeof resolveLandscape> | null = null;
          let thrown: unknown = null;
          const b = body(linked, selection);
          try { step = resolveLandscape(runConfig(b, new Date("2026-11-17T07:00:00Z")), b, { landscapes }); } catch (e) { thrown = e; }
          // Both run, or neither does.
          expect(check.ok).toBe(step !== null);
          if (check.ok && step) {
            expect(String(step.landscape_id)).toBe(check.summary.id);
            expect(String(step.client_company_id)).toBe(check.summary.client_company_id);
            expect(check.selection).toBe(true);
          } else if (landscapes.length === 0) {
            // No landscapes is an answer that went wrong, on both sides: the step's ordinary error is tried again, and
            // the check could not ask. Neither is a fact, and nothing is recorded.
            expect(thrown).toBeInstanceOf(Error);
            expect(thrown).not.toBeInstanceOf(StepStop);
            expect((thrown as Error).message).toBe(NO_LANDSCAPES);
            expect(check).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE });
            expect(isTrackingProblem(check)).toBe(false);
            expect(trackingCheckRecord(check, linked)).toBeNull();
          } else {
            // The step's refusal is a selection fact (no further tries), and the check's is a tracking problem (the run waits).
            expect(thrown).toBeInstanceOf(SelectionFact);
            expect(thrown).toBeInstanceOf(StepStop);
            const fact = thrown as SelectionFact;
            expect(selectionFactIn(fact.message)).toBe(fact.code);
            expect(isTrackingProblem(check)).toBe(true);
            // No link: setup under way. A link that is in the list: not covered, and kept. Only a link that is not in the list is gone.
            const gone = !!linked && !landscapes.some((l) => String((l as { id: unknown }).id) === linked);
            expect(check).toMatchObject({ code: !linked ? CLIENT_NOT_TRACKED : gone ? LANDSCAPE_MISSING : SELECTION_NOT_COVERED });
            expect(fact.code === "LANDSCAPE_NOT_FOUND").toBe(!linked || gone);
            expect(trackingCheckRecord(check, linked)?.gone).toBe(gone ? true : undefined);
          }
        });
      }
    }
  }

  it("the step takes a fact only from RivalIQ's own landscapes list; the same words from any other shape are a fault to try again", () => {
    const b = body(null);
    const cfg = runConfig(b, new Date("2026-11-17T07:00:00Z"));
    const outcome = (resp: unknown) => { try { resolveLandscape(cfg, b, resp); return null; } catch (e) { return e as Error; } };
    // The documented key: a fact, stopped at once.
    expect(outcome({ landscapes: [OLD] })).toBeInstanceOf(SelectionFact);
    // The fallbacks the n8n node also reads still let a tracked selection run, but say "not tracked" only as an ordinary error.
    for (const resp of [{ data: [OLD] }, { items: [OLD] }, [OLD]]) {
      const e = outcome(resp);
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(StepStop);
      expect(e!.message).toBe(SELECTION_FACT_MESSAGES.LANDSCAPE_NOT_FOUND);
    }
    expect(outcome({ data: [OWN] })).toBeNull();
    // Nothing readable at all: no landscapes, an error body, a list whose entries do not list their companies.
    for (const resp of [{}, { landscapes: [] }, { error: "try later" }, { landscapes: [{ id: 501 }] }, { landscapes: [OLD, null] }]) {
      const e = outcome(resp);
      expect(e, JSON.stringify(resp)).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(StepStop);
    }
  });
});

describe("resolveSelectionLandscape: what the dispatch is told", () => {
  it("a set with no link that is not tracked waits for tracking, in words that ask nobody to act", () => {
    const r = resolveSelectionLandscape([OLD] as never, CLIENT, SELECTION, null);
    expect(r).toMatchObject({ ok: false, code: CLIENT_NOT_TRACKED, landscapeId: null });
    expect(!r.ok && r.message).toBe("No RivalIQ landscape tracks Northwind Bikes and every confirmed competitor yet. Tracking for the confirmed competitors is connected on its own, and the analysis runs once it is.");
  });

  it("a linked landscape that is there but does not hold the selection waits and keeps its link: not covered, never gone", () => {
    const message = (landscapes: unknown[], linked: string) => { const r = resolveSelectionLandscape(landscapes as never, CLIENT, SELECTION, linked); return r.ok ? "" : `${r.code} ${r.message}`; };
    expect(message([OLD], "501")).toBe(`${SELECTION_NOT_COVERED} The RivalIQ landscape linked to Northwind Bikes's competitor set (501) does not hold the confirmed selection: it does not track Fabrikam Wheels and Contoso Rides exactly once. The analysis waits until it does, and the link is kept as it is.`);
    expect(message([OTHERS], "12")).toContain(`${SELECTION_NOT_COVERED} The RivalIQ landscape linked to Northwind Bikes's competitor set (12) does not hold the confirmed selection: it does not track Northwind Bikes as exactly one company.`);
    const r = resolveSelectionLandscape([OLD] as never, CLIENT, SELECTION, "501");
    expect(r).toMatchObject({ ok: false, code: SELECTION_NOT_COVERED, landscapeId: "501", selection: true, uncovered: { client: false, competitors: ["Fabrikam Wheels", "Contoso Rides"] } });
    expect(r).not.toHaveProperty("gone");
  });

  it("only a link that is not in a readable list is gone", () => {
    const gone = resolveSelectionLandscape([OWN] as never, CLIENT, SELECTION, "999");
    expect(gone).toMatchObject({ ok: false, code: LANDSCAPE_MISSING, landscapeId: "999", selection: true, gone: true });
    expect(!gone.ok && gone.message).toContain("The RivalIQ landscape linked to Northwind Bikes's competitor set (999) no longer exists.");
    // From an answer that cannot be read, nothing is concluded.
    for (const landscapes of [[], null, [OWN, { name: "no id" }]]) {
      const unasked = resolveSelectionLandscape(landscapes as never, CLIENT, SELECTION, "999");
      expect(unasked).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE });
      expect(isTrackingProblem(unasked)).toBe(false);
      expect(trackingCheckRecord(unasked, "999")).toBeNull();
    }
    // The linked landscape is listed, but without its companies: not gone, not "not covered", just unread.
    expect(resolveSelectionLandscape([{ id: 777, name: "x" }] as never, CLIENT, SELECTION, "777")).toMatchObject({ ok: false, code: RIVALIQ_UNAVAILABLE });
  });

  it("records what a screen reads: the selection decision, and nothing from any other answer", () => {
    const now = new Date("2026-11-17T07:00:00Z");
    const found = trackingCheckRecord(resolveSelectionLandscape([OLD, OWN] as never, CLIENT, SELECTION, null), null, now);
    expect(found).toEqual({ code: "ok", landscape_id: null, message: null, checked_at: now.toISOString(), found_landscape_id: "777" });
    // A linked set's record is unchanged.
    expect(trackingCheckRecord(resolveSelectionLandscape([OWN] as never, CLIENT, SELECTION, "777"), "777", now)).toEqual({ code: "ok", landscape_id: "777", message: null, checked_at: now.toISOString() });
    expect(trackingCheckRecord(resolveSelectionLandscape([OLD] as never, CLIENT, SELECTION, null), null, now)).toMatchObject({ code: CLIENT_NOT_TRACKED, landscape_id: null });
    expect(trackingCheckRecord(resolveSelectionLandscape([OLD] as never, CLIENT, SELECTION, "501"), "501", now)).toMatchObject({ code: SELECTION_NOT_COVERED, landscape_id: "501", uncovered: { client: false, competitors: ["Fabrikam Wheels", "Contoso Rides"] } });
    expect(trackingCheckRecord(resolveSelectionLandscape([OLD] as never, CLIENT, SELECTION, "999"), "999", now)).toMatchObject({ code: LANDSCAPE_MISSING, landscape_id: "999", gone: true });
    // The feed's own answer, which asks only whether the client is tracked, writes nothing: it cannot overwrite the decision.
    for (const linked of [null, "501", "999"]) expect(trackingCheckRecord(resolveClientLandscape([OLD] as never, CLIENT, linked), linked, now)).toBeNull();
  });
});

describe("trackedOnRecord: what every screen and the run request read, with no provider call", () => {
  const at = "2026-11-17T07:00:00Z";
  it("a linked set is tracked, unless the last check of that link found a problem", () => {
    expect(trackedOnRecord({ rivaliq_landscape_id: "777" })).toBe(true);
    expect(trackedOnRecord({ rivaliq_landscape_id: "777", tracking_check: { code: "ok", landscape_id: "777", checked_at: at } })).toBe(true);
    expect(trackedOnRecord({ rivaliq_landscape_id: "777", tracking_check: { code: LANDSCAPE_MISSING, landscape_id: "777", checked_at: at } })).toBe(false);
    // A record about an earlier link says nothing about this one.
    expect(trackedOnRecord({ rivaliq_landscape_id: "777", tracking_check: { code: LANDSCAPE_MISSING, landscape_id: "501", checked_at: at } })).toBe(true);
  });

  it("a set with no link is not tracked: its tracking has not started", () => {
    expect(trackedOnRecord(null)).toBe(false);
    expect(trackedOnRecord({})).toBe(false);
    expect(trackedOnRecord({ rivaliq_landscape_id: null })).toBe(false);
    expect(trackedOnRecord({ rivaliq_landscape_id: "  " })).toBe(false);
    expect(trackedOnRecord({ rivaliq_landscape_id: null, tracking_check: { code: CLIENT_NOT_TRACKED, landscape_id: null, checked_at: at } })).toBe(false);
    // What the earlier check left on a set with no link: "ok" for a landscape that tracked the client alone.
    expect(trackedOnRecord({ rivaliq_landscape_id: null, tracking_check: { code: "ok", landscape_id: null, message: null, checked_at: at } })).toBe(false);
  });

  it("a set with no link is tracked once the shared check found one landscape holding the whole selection", () => {
    expect(trackedOnRecord({ rivaliq_landscape_id: null, tracking_check: { code: "ok", landscape_id: null, checked_at: at, found_landscape_id: "640" } })).toBe(true);
  });

  it("a linked landscape that does not hold the selection is not tracked, and says what it lacks; one that is gone says so", () => {
    const notCovered = { rivaliq_landscape_id: "501", tracking_check: { code: SELECTION_NOT_COVERED, landscape_id: "501", checked_at: at, uncovered: { client: false, competitors: ["Contoso Rides"] } } };
    expect(trackedOnRecord(notCovered)).toBe(false);
    expect(recordedTracking(notCovered)).toEqual({ state: "not_covered", uncovered: { client: false, competitors: ["Contoso Rides"] } });
    expect(recordedTracking({ rivaliq_landscape_id: "501", tracking_check: { code: SELECTION_NOT_COVERED, landscape_id: "501", checked_at: at } })).toEqual({ state: "not_covered", uncovered: null });
    expect(recordedTracking({ rivaliq_landscape_id: "777", tracking_check: { code: LANDSCAPE_MISSING, landscape_id: "777", checked_at: at, gone: true } })).toEqual({ state: "gone" });
    // An older record of a missing landscape names no cause: not tracked, and nothing more is said.
    expect(recordedTracking({ rivaliq_landscape_id: "777", tracking_check: { code: LANDSCAPE_MISSING, landscape_id: "777", checked_at: at } })).toEqual({ state: "not_tracked" });
    expect(recordedTracking({ rivaliq_landscape_id: "777" })).toEqual({ state: "tracked" });
    expect(recordedTracking({ rivaliq_landscape_id: null })).toEqual({ state: "not_started" });
    expect(recordedTracking(null)).toEqual({ state: "not_started" });
    // A decision about a link the set no longer has says nothing about a set with none.
    expect(recordedTracking({ rivaliq_landscape_id: null, tracking_check: { code: SELECTION_NOT_COVERED, landscape_id: "501", checked_at: at } })).toEqual({ state: "not_started" });
  });

  it("the schedule's note begins with the words the screens read", () => {
    expect(NEEDS_TRACKING).toBe("needs tracking");
  });
});
