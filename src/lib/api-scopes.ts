/**
 * The key permissions the Settings page offers, with the plain hint shown
 * under each. api-scopes.test.ts fails when the API gains a scope
 * (SCOPES in supabase/functions/_shared/api/router.ts) this list lacks.
 */
export type KeyScope = "read" | "run" | "demo" | "costs" | "admin";

export const KEY_SCOPES: Array<{ id: KeyScope; label: string; hint: string }> = [
  { id: "read", label: "read", hint: "Every client, report, competitor set, post, schedule and alert the key may see." },
  { id: "run", label: "run", hint: "Start work for the clients the key may see: start a social or competitive report, draft a post or its copy, start a post's designs, propose competitors, refresh the competitor feed, plan a calendar week. Paid work is charged to the client, and the key acts as the person who made it." },
  { id: "demo", label: "demo", hint: "Start demo jobs that onboard a brand and run each feature for it." },
  { id: "costs", label: "costs", hint: "Read what each client costs in paid AI and data services (for the moburst.ai costs page)." },
  { id: "admin", label: "admin", hint: "Manage keys through the API." },
];
