// QA 22 Nov 2026 (P38-1): a step run through the queue (runLifecycle claims the row as "running",
// then runLifecycleStep reads the rows) hands the step a `previous` row whose status
// is "running", never "failed". design_refs reads previous.status === "failed" to
// count failed runs in a row (failedBefore), so the "give up after 2 failures" rule
// in brand-references/discover.ts never fires in production.
import { afterEach, describe, expect, it, vi } from "vitest";

const seen: Array<{ failedBefore?: number }> = [];
vi.mock("../../../functions/_shared/brand-references/learnStyle.ts", async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>();
  return {
    ...real,
    refreshReferences: async (_db: unknown, _id: string, _io: unknown, opts: { failedBefore?: number }) => {
      seen.push({ failedBefore: opts.failedBefore });
      return { kind: "in_progress", reviewed: 0, left: 1, progress: null };
    },
  };
});

import { runLifecycle, runLifecycleStep } from "../../../functions/_shared/lifecycle/run";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../support/lifecycleFakeDb";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); seen.length = 0; });

const NOW = new Date("2026-11-20T10:00:00Z");
function world() {
  const client = { id: "c1", name: "Harbor Coffee", website_url: null, archived_at: null, demo_job_id: null, field_sources: {}, company_slug: "harbor-coffee", design_references: null, sprout_customer_id: null };
  const db = fakeDb({
    clients: [client], client_lifecycle_steps: [], scheduled_jobs: [], competitor_sets: [], sprout_profile_removals: [],
    sprout_profiles: [{ client_id: "c1", sprout_profile_id: 7, network_type: "fb_instagram_account", is_active: true }],
    design_reference_choices: [], content_strategies: [],
  }, { lifecycle_write_client: writeClientRpc });
  deps.refsIO = (() => ({})) as never;
  return { db, client };
}

async function failedTwice(db: ReturnType<typeof fakeDb>, client: Record<string, unknown>) {
  const key = await STEPS.design_refs.inputs(db, client as never, new Map());
  db.tables.client_lifecycle_steps.push({
    client_id: "c1", step: "design_refs", inputs_key: key, status: "failed", attempts: 2, attempted_at: "2026-11-19T09:00:00Z",
    done_at: null, next_attempt_at: "2026-11-20T09:00:00Z", result: null, error: "The reference quality check did not answer. It will be tried again.",
  });
}

describe("a step run through the queue sees the row it had before the claim", () => {
  it("design_refs is told it failed twice before", async () => {
    const b = world();
    await failedTwice(b.db, b.client);
    const look = await runLifecycle(b.db, { id: "look", client_id: "c1", payload: null }, NOW);
    expect(look.reason).toContain("design_refs (retry)");
    await runLifecycleStep(b.db, { id: "job", client_id: "c1", payload: { step: "design_refs", force: true } }, NOW);
    // The queued path (every production retry): failedBefore must also be 2.
    expect(seen.at(-1)).toEqual({ failedBefore: 2 });
  });
});
