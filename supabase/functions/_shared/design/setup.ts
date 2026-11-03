// supabase/functions/_shared/design/setup.ts
//
// What a client's setup still waits for before designs can start, and how
// that is said. Designs start once the client's design settings are
// confirmed (design_brand_settings.confirmed_at); until then the lifecycle's
// own steps say what is missing (design_refs, design_settings). One rule and
// one sentence for the design button's server (design-request/week.ts), its
// screen (src/lib/designWeek.ts) and the API's client readiness
// (_shared/socialytics-api/serializers.ts), so all three say the same thing.
// Pure: no Deno globals, no network.

/** What the setup waits for: the logo file, social accounts, enough designed posts, or else the look itself. */
export type DesignWaitingFor = "look" | "designed_posts" | "social_accounts" | "logo_file";

/** The lifecycle steps the rule reads, from client_lifecycle_steps. */
export const DESIGN_SETUP_STEPS = ["design_refs", "design_settings"] as const;

export interface DesignStepRow {
  step: string;
  status: string | null;
  result?: unknown;
}

const waitingOf = (row: DesignStepRow | undefined): string => {
  if (row?.status !== "waiting" || !row.result || typeof row.result !== "object") return "";
  return String((row.result as { waiting_for?: unknown }).waiting_for ?? "");
};

/** The lifecycle's own words for the wait (design_settings first, then design_refs), else "look". */
export function designWaitingFor(steps: DesignStepRow[]): DesignWaitingFor {
  const step = (name: string) => steps.find((r) => r.step === name);
  if (waitingOf(step("design_settings")) === "logo_file") return "logo_file";
  const refs = waitingOf(step("design_refs"));
  if (refs === "social_accounts" || refs === "designed_posts") return refs;
  return "look";
}

/** "Designs start once Pay The Pyper's look is learned from its own posts." */
export function designWaitingLine(waitingFor: DesignWaitingFor | null | undefined, clientName: string | null | undefined): string {
  const name = clientName?.trim() || "this client";
  const its = clientName?.trim() ? `${name}'s` : "this client's";
  if (waitingFor === "logo_file") return `Designs start once ${its} logo file is found on its website.`;
  if (waitingFor === "designed_posts") return `Designs start once ${name} has published enough designed posts to learn its look from.`;
  if (waitingFor === "social_accounts") return `Designs start once ${its} social accounts are connected.`;
  return `Designs start once ${its} look is learned from its own posts.`;
}
