// supabase/functions/_shared/lifecycle/steps.ts
//
// The steps of a client's lifecycle, each with the inputs it depends on and
// how it runs. More steps join as the self-serve build goes on (spec:
// docs/superpowers/specs/2026-10-19-self-serve-lifecycle-design.md).

import { referenceFingerprint } from "../brand-references/candidates.ts";
import { StyleError } from "../brand-references/errors.ts";
import { learnBrandStyle } from "../brand-references/learnStyle.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";
import type { StepOutcome, StepPolicy } from "./policy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export type ClientRow = Record<string, any>;

export interface StepDef {
  policy: StepPolicy;
  /** What the step depends on, as one key; null while an input does not exist yet. */
  inputs(db: Db, client: ClientRow): Promise<string | null>;
  run(db: Db, client: ClientRow, opts: { force: boolean }): Promise<StepOutcome>;
}

/** Steps in the order a new client goes through them. */
export const STEPS: Record<string, StepDef> = {
  // The client's designed posts and the visual style learned from them. Runs
  // when its social accounts change, and every 90 days (the posts window), so
  // the style follows what the brand publishes now.
  design_refs: {
    policy: { refreshDays: 90, recheckDays: 30 },
    async inputs(db, client) {
      const { data, error } = await db.from("sprout_profiles").select("sprout_profile_id").eq("client_id", client.id).eq("is_active", true);
      if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
      const ids = (data ?? []).map((p: { sprout_profile_id: string }) => String(p.sprout_profile_id));
      return ids.length ? referenceFingerprint(ids, String(client.sprout_customer_id || defaultSproutCustomerId())) : null;
    },
    async run(db, client, { force }) {
      try {
        const learned = await learnBrandStyle(db, String(client.id), { discover: true, force });
        return { status: "done", result: { references: learned.refs?.length ?? 0, cached: learned.cached, synthesized_at: learned.synthesis?.synthesized_at ?? null } };
      } catch (e) {
        if (!(e instanceof StyleError)) throw e;
        if (e.code === "no_accounts") return { status: "waiting", reason: "social_accounts" };
        if (e.code === "too_few" || e.code === "no_sources") return { status: "waiting", reason: "designed_posts", recheckDays: 30 };
        if (e.code === "accounts_changed") return { status: "failed", error: e.message, soonMinutes: 5 };
        return { status: "failed", error: e.message };
      }
    },
  },
};

export const STEP_NAMES = Object.keys(STEPS);
