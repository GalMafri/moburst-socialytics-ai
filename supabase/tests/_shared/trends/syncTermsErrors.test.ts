// QA 22 Nov 2026 (P52-04): syncLifecycleTerms awaits its update and delete but never reads their error.
import { describe, it, expect } from "vitest";
import { fakeDb } from "../../../functions/_shared/db.fake";
import { syncLifecycleTerms } from "../../../functions/_shared/trends/profile";

describe("P52-04 a profile rewrite whose old terms could not be taken away", () => {
  it("fails instead of reporting the terms in line with the new profile", async () => {
    const { db } = fakeDb((call) => {
      const verbs = call.ops.map(([n]) => n);
      if (verbs.includes("delete") || verbs.includes("update")) return { error: { message: "permission denied" } };
      if (verbs.includes("select")) return { data: [
        { id: "old", term: "old topic", reason: "r", source: "lifecycle", removed_at: null },
        { id: "keep", term: "kept topic", reason: "old reason", source: "lifecycle", removed_at: null },
      ] };
      return {};
    });
    await expect(syncLifecycleTerms(db, "c1", "topic", null, [{ term: "kept topic", reason: "new reason" }])).rejects.toThrow();
  });
});
