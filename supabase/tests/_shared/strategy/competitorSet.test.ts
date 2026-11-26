import { describe, expect, it } from "vitest";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { latestCompetitorSet, selectedCompetitors } from "../../../functions/_shared/strategy/competitorSet";

describe("the client's competitor set", () => {
  const db = () => fakeDb({
    competitor_sets: [
      { id: "old", client_id: "c1", status: "complete", confirmed_at: "2026-09-01", created_at: "2026-09-01" },
      { id: "new", client_id: "c1", status: "confirmed", confirmed_at: "2026-10-01", created_at: "2026-10-01" },
      { id: "draft", client_id: "c1", status: "draft", confirmed_at: null, created_at: "2026-11-01" },
      { id: "other", client_id: "c2", status: "confirmed", confirmed_at: "2026-11-01", created_at: "2026-11-01" },
    ],
    competitors: [
      { id: "k1", set_id: "new", name: "BenchApp", is_selected: true },
      { id: "k2", set_id: "new", name: "Skipped", is_selected: false },
    ],
  });

  it("is the newest readable one, and its selected companies", async () => {
    const set = await latestCompetitorSet(db(), "c1");
    expect(set.data?.id).toBe("new");
    const names = await selectedCompetitors(db(), "new", "name");
    expect((names.data as Array<{ name: string }>).map((r) => r.name)).toEqual(["BenchApp"]);
  });
});
