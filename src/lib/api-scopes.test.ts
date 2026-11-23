import { describe, it, expect } from "vitest";
import { SCOPES } from "../../supabase/functions/_shared/api/router";
import { KEY_SCOPES } from "./api-scopes";

describe("the key settings scopes", () => {
  it("offer every scope the API knows, and only those, each with a hint", () => {
    expect(KEY_SCOPES.map((s) => s.id).sort(), "Add the new scope to KEY_SCOPES in src/lib/api-scopes.ts with a plain hint").toEqual([...SCOPES].sort());
    for (const s of KEY_SCOPES) expect(s.hint.length, s.id).toBeGreaterThan(10);
  });
});
