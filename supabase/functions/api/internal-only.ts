/**
 * The functions the screens call that are deliberately not public actions,
 * with the reason (the public actions are _shared/socialytics-api/actions.ts).
 * supabase/tests/api/actions-coverage.test.ts fails when a screen calls a
 * function that is in neither. Nothing imports it at run time.
 */
export const INTERNAL_ONLY: Record<string, string> = {
  api: "The public API itself (the API page manages keys through it).",
  "gos-auth-bridge": "Sign-in bridge from moburst.ai into a Socialytics session; not a task.",
  "hub-auth-bridge": "Sign-in bridge from the Moburst hub into a Socialytics session; not a task.",
  "role-preview": "Lets a staff member preview the app as a client user; a session switch, not work on a client.",
  "google-auth": "Connects the team's Google account for strategy decks, once, from Settings; an account setup step.",
  "higgsfield-auth": "Links the team's Higgsfield account, once, from Settings; an account setup step with a person's sign-in.",
  "delete-client": "Hard-deletes a client and everything kept for it; destructive and admin-only, so it stays in the app.",
  "sprout-analytics": "A read: the API serves it as GET /v1/clients/:id/analytics with the read scope.",
  "sprout-profiles": "Lists the agency's Sprout profiles and queues a Sprout sync for the setup screens; account setup, not client work.",
  "post-preview": "Resolves thumbnails for social post links the report screens show; a display helper.",
  "schedule-sprout-post": "Sends a post to a client's Sprout publishing calendar; publishing stays a person's step in the app.",
  "client-notes": "Adds and edits the notes staff keep about a client; the Claude connector saves notes for staff, and the API does not take free text into a client's record.",
  "confirm-competitor-set": "A person confirms the competitor set and its ranking on the Competitors screen; that judgement stays with the team.",
  "detect-competitor-handles": "Re-detects one proposed competitor's social handles while a person reviews the set; identify_competitors already detects them for a new draft.",
  "import-rivaliq-landscape": "Imports a RivalIQ landscape as a competitor set; an account-level choice made in the app.",
  "get-creative-plan": "Reads the creative plan a post panel shows beside a design; a display read for that panel.",
  "record-design-feedback": "Turns down or archives a design with the person's reason, which teaches the client's design memory; a person's judgement.",
  "revise-suggestion": "Rewrites a competitive report's suggested test from the team's feedback, and learns from the edit; a person's judgement on the report.",
  "extract-brand-from-file": "Reads an uploaded brand book on the setup page; needs a file in storage, and the client lifecycle reads the brand on its own.",
  mcp: "The Claude connector; the API page shows its address. It starts the public actions itself, through its work tools.",
  "research-brand-identity": "Reads a brand from its website on the setup page and saves nothing; the client lifecycle reads the brand on its own.",
};
