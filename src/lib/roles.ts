export type AppRole = "admin" | "moburst_user" | "client";

/**
 * The roles Socialytics admits, strongest first. The app and the consent page
 * read this order. The Claude connector keeps its own copy (RANK in
 * supabase/functions/mcp/access.ts), and supabase/tests/mcp/project-text.test.ts
 * keeps that copy equal to this one.
 */
export const ROLE_RANK: readonly AppRole[] = ["admin", "moburst_user", "client"];

/** The strongest admitted role among the roles a person holds, or null when none of them is admitted. */
export function strongestRole(held: readonly string[]): AppRole | null {
  return ROLE_RANK.find((r) => held.includes(r)) ?? null;
}
