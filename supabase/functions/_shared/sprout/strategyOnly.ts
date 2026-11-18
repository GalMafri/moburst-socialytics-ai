// supabase/functions/_shared/sprout/strategyOnly.ts
//
// A strategy-only client (18 Nov 2026): a client with no active account in
// Sprout. It gets its strategy; its calendar, designs, analytics and reports
// are closed until an account is connected, and open by themselves the
// moment one is. Nothing is stored for it: the state is read from
// sprout_profiles every time.
//
// One definition, in the database (20261118140000_strategy_only_clients.sql):
//
//   client_in_sprout(client)      the client has at least one row in
//                                 sprout_profiles with is_active = true. An
//                                 account the one-account-per-network rule
//                                 set aside is not active, and the account
//                                 it kept is, so that client is in Sprout.
//   client_strategy_only(client)  the client exists, is not a demo copy the
//                                 API made for a prospect (a demo runs only
//                                 the steps its demo job asks for), and is
//                                 not in Sprout.
//   strategy_only_clients()       those clients among the ones the caller
//                                 can see, for the screens.
//
// The daily enqueue, the plan and revision requests and the weekly trends
// enqueue ask client_strategy_only in the database. The worker, the client
// lifecycle and each action a person starts ask it through isStrategyOnly
// below, and the screens through strategyOnlyClients, so every place reads
// the same answer. The sentences are here too, so the server's refusal and
// the screens say the same thing.
//
// Pure: no Deno globals and no network, so the app imports it as well.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** True when the client is strategy-only (client_strategy_only). Throws when the database does not answer. */
export async function isStrategyOnly(db: Db, clientId: string): Promise<boolean> {
  const { data, error } = await db.rpc("client_strategy_only", { p_client: clientId });
  if (error) throw new Error(`Could not read whether the client's social accounts are connected: ${error.message}`);
  return data === true;
}

/** The strategy-only clients the caller can see (strategy_only_clients), as a set of client ids. */
export async function strategyOnlyClients(db: Db): Promise<Set<string>> {
  const { data, error } = await db.rpc("strategy_only_clients");
  if (error) throw new Error(`Could not read which clients are set up for strategy only: ${error.message}`);
  // A set-returning function answers with bare ids, or with one-column rows.
  const rows = (Array.isArray(data) ? data : []) as unknown[];
  return new Set(rows.map((r) => (r && typeof r === "object" ? String(Object.values(r as Record<string, unknown>)[0] ?? "") : String(r ?? ""))).filter(Boolean));
}

/** The sentence's first half: "<Client> is set up for strategy only". A screen's notice uses it as its heading. */
export function strategyOnlyLead(clientName: string | null | undefined): string {
  return `${clientName?.trim() || "This client"} is set up for strategy only`;
}

/**
 * The sentence's second half: what is closed, and what opens it. A client's
 * own user never reads the name of the tool the team connects accounts in,
 * so there are two wordings: the plain one, which every server answer and a
 * client user's screens use, and the staff one, which names Sprout.
 */
export const STRATEGY_ONLY_OPENS = "Its calendar, designs, analytics and reports open once its social accounts are connected.";
export const STRATEGY_ONLY_OPENS_STAFF = "Its calendar, designs, analytics and reports open once its social accounts are connected in Sprout.";

/** What opens it, for this viewer. */
export const strategyOnlyOpens = (staff: boolean): string => (staff ? STRATEGY_ONLY_OPENS_STAFF : STRATEGY_ONLY_OPENS);

/** The one sentence a refused request answers with: the plain wording, since a client's own user can receive it. */
export function strategyOnlySentence(clientName: string | null | undefined): string {
  return `${strategyOnlyLead(clientName)}. ${STRATEGY_ONLY_OPENS}`;
}

/** The same in a few words, for a card or a row of a list: plain, and for staff. */
export const STRATEGY_ONLY_SHORT = "Strategy only until its social accounts are connected.";
export const STRATEGY_ONLY_SHORT_STAFF = "Strategy only until its social accounts are connected in Sprout.";
export const strategyOnlyShort = (staff: boolean): string => (staff ? STRATEGY_ONLY_SHORT_STAFF : STRATEGY_ONLY_SHORT);

/** Why a queued job for such a client ends without running (scheduled_jobs.reason, read by developers). */
export const STRATEGY_ONLY_JOB_REASON = "The client is set up for strategy only: nothing is made until its social accounts are connected in Sprout.";

/**
 * What a request to make something for the client is refused with: the
 * sentence, with the client's name, or null when the client is not
 * strategy-only and the request goes ahead.
 */
export async function strategyOnlyRefusal(db: Db, clientId: string): Promise<string | null> {
  if (!(await isStrategyOnly(db, clientId))) return null;
  const { data } = await db.from("clients").select("name").eq("id", clientId).maybeSingle();
  return strategyOnlySentence(data?.name as string | null | undefined);
}
