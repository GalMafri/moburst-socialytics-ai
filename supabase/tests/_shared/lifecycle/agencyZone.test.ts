// @vitest-environment node
// The agency time zone (spec: docs/superpowers/specs/2026-11-08-onboarding-
// profile-pages-and-no-n8n-design.md, section E): the zone most of the
// agency's clients have from a real source, for a client no source places.
import { describe, expect, it } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { agencyZone, mostCommonZone } from "../../../functions/_shared/lifecycle/agencyZone";

const NY = "America/New_York";
const sourced = (timezone: string, from = "schema.org") => ({ timezone, field_sources: { timezone: { by: "lifecycle", at: "now", from } } });
const unsourced = (timezone: string | null) => ({ timezone, field_sources: {} });

describe("mostCommonZone", () => {
  it("takes the zone of the 11 sourced clients, never the 2 unsourced ones on UTC", () => {
    const rows = [...Array.from({ length: 11 }, () => sourced(NY)), unsourced("UTC"), unsourced("UTC")];
    expect(mostCommonZone(rows)).toBe(NY);
  });

  it("is null when no client's zone came from a source", () => {
    expect(mostCommonZone([unsourced("UTC"), unsourced("America/Chicago"), unsourced(null)])).toBeNull();
    expect(mostCommonZone([])).toBeNull();
  });

  it("counts a zone a person set, and never UTC or a zone nobody set", () => {
    const rows = [
      { timezone: "Europe/London", field_sources: { timezone: { by: "person", at: "now" } } },
      { timezone: "UTC", field_sources: { timezone: { by: "person", at: "now" } } },
      { timezone: "UTC", field_sources: { timezone: { by: "person", at: "now" } } },
      unsourced("America/Chicago"), unsourced("America/Chicago"),
    ];
    expect(mostCommonZone(rows)).toBe("Europe/London");
  });

  it("never counts a zone the agency default gave, so the default cannot feed itself", () => {
    const rows = [sourced("America/Chicago", "followers"), sourced(NY, "agency"), sourced(NY, "agency")];
    expect(mostCommonZone(rows)).toBe("America/Chicago");
  });

  it("gives a tie to the alphabetically first zone", () => {
    expect(mostCommonZone([sourced(NY), sourced("America/Chicago"), sourced(NY), sourced("America/Chicago")])).toBe("America/Chicago");
  });
});

describe("agencyZone", () => {
  it("reads the active clients that are not archived, leaving out the client asked about", async () => {
    const db = fakeDb({
      clients: [
        // Counted with the others, this client's own zone would break the tie for New York.
        { id: "me", archived_at: null, demo_job_id: null, ...sourced(NY) },
        { id: "a", archived_at: null, demo_job_id: null, ...sourced(NY) },
        { id: "b", archived_at: null, demo_job_id: null, ...sourced("America/Chicago", "post_text") },
        { id: "gone", archived_at: "2026-10-01T00:00:00Z", demo_job_id: null, ...sourced(NY) },
        { id: "gone2", archived_at: "2026-10-01T00:00:00Z", demo_job_id: null, ...sourced(NY) },
        { id: "demo", archived_at: null, demo_job_id: "j1", ...sourced(NY) },
        { id: "demo2", archived_at: null, demo_job_id: "j2", ...sourced(NY) },
        { id: "new", archived_at: null, demo_job_id: null, ...unsourced("UTC") },
      ],
    });
    expect(await agencyZone(db, "me")).toBe("America/Chicago");
  });

  it("is null when the clients cannot be read", async () => {
    const db = fakeDb();
    // Any chain of filters ends in an error.
    const failing: object = new Proxy({}, { get: (_t, k) => (k === "then" ? (res: (r: unknown) => unknown) => res({ data: null, error: { message: "down" } }) : () => failing) });
    db.from = () => failing;
    expect(await agencyZone(db, "me")).toBeNull();
  });
});
