// @vitest-environment node
// 20261118140000_strategy_only_clients.sql. A client with no active account
// in Sprout is strategy-only: it keeps its strategy, and its calendar, its
// reports and its weekly trends are not started until it has an account.
//
// Read as text: the three definitions, and each restated function held to
// its latest earlier definition with one condition added and nothing else.
// Then applied twice to PGlite over the tables it reads, and run: such a
// client is left out, a client with an account is untouched, and a client
// that gets an account is planned, reported and collected again.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const migrations = join(functionsDir, "..", "migrations");
const FILE = "20261118140000_strategy_only_clients.sql";
const raw = readFileSync(join(migrations, FILE), "utf8");
const flat = (text: string) => text.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const sql = flat(raw);
const definition = (text: string, name: string) => {
  const m = new RegExp(`create or replace function public\\.${name}\\(([^)]*)\\)([\\s\\S]*?)\\$\\$([\\s\\S]*?)\\$\\$;`, "i").exec(text);
  if (!m) throw new Error(`${name} is not defined`);
  return { args: m[1].trim(), head: m[2].trim(), body: m[3].trim() };
};
const earlier = (file: string, name: string) => definition(flat(readFileSync(join(migrations, file), "utf8")), name);
const GATE = " and not public.client_strategy_only(c.id)";

describe(`${FILE}, as text`, () => {
  it("adds functions only: no table, column, policy, trigger or row is added, changed or removed", () => {
    expect(sql).not.toMatch(/\bdrop\b|\btruncate\b|\balter\b|create table|create (unique )?index|create trigger|create policy|create (or replace )?view|enable row level security/i);
    // The only writes are the ones the restated functions already made.
    expect(sql.match(/create or replace function public\.([a-z_]+)\(/gi)?.map((m) => m.replace(/^.*public\./i, "").replace("(", ""))).toEqual([
      "client_in_sprout", "client_strategy_only", "strategy_only_clients", "voice_profile_request",
      "calendar_request_week", "calendar_request_revision", "enqueue_scheduled_report_jobs", "enqueue_trend_refresh_jobs", "scheduled_report_gaps",
    ]);
    expect(sql).not.toMatch(/create function/i);
  });

  it("defines in Sprout as at least one active account, and strategy-only as a client that is not a demo copy and is not in Sprout", () => {
    expect(definition(sql, "client_in_sprout").body).toBe("select exists (select 1 from sprout_profiles sp where sp.client_id = p_client and sp.is_active = true);");
    expect(definition(sql, "client_strategy_only").body).toBe("select exists (select 1 from clients c where c.id = p_client and c.demo_job_id is null and not client_in_sprout(c.id));");
    // The screens' list is the same rule over the clients the caller can see, and nothing else.
    expect(definition(sql, "strategy_only_clients").body).toBe("select c.id from clients c where (coalesce(auth.role(), '') = 'service_role' or can_access_client(c.id)) and client_strategy_only(c.id);");
    // Read from the accounts every time: nothing is stored.
    for (const name of ["client_in_sprout", "client_strategy_only", "strategy_only_clients"]) {
      expect(definition(sql, name).head).toMatch(/language sql stable security definer set search_path = public as$/);
    }
  });

  it("lets only the server ask about one client, and a signed-in person read the list of the clients they can see", () => {
    expect(sql).toContain("revoke all on function public.client_in_sprout(uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.client_in_sprout(uuid) to service_role;");
    expect(sql).toContain("revoke all on function public.client_strategy_only(uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.client_strategy_only(uuid) to service_role;");
    expect(sql).toContain("revoke all on function public.strategy_only_clients() from public, anon;");
    expect(sql).toContain("grant execute on function public.strategy_only_clients() to authenticated, service_role;");
  });

  it("asks for a strategy-only client's voice profile by the rule, the job key and the priority a plan request uses", () => {
    const voice = definition(sql, "voice_profile_request");
    const week = definition(sql, "calendar_request_week").body;
    // The same test and the same key, word for word, as calendar_request_week has them.
    for (const line of [
      "v_first_monday := v_month + ((8 - extract(isodow from v_month)::int) % 7);",
      "select (social_voice->>'built_at')::timestamptz into v_voice from clients where id = p_client;",
      "if v_voice is null or (current_date >= v_first_monday and v_voice::date < v_first_monday) then insert into scheduled_jobs (kind, client_id, dedupe_key, priority, available_at) values ('voice_profile', p_client, 'voice_profile:' || p_client || ':' || to_char(current_date, 'YYYY-MM-DD'),",
    ]) {
      expect(voice.body).toContain(line);
      expect(week).toContain(line);
    }
    // 39: one before a plan the product asked for (40), as calendar_request_week gives it (v_priority - 1).
    expect(voice.body).toContain("to_char(current_date, 'YYYY-MM-DD'), 39, now()) on conflict (dedupe_key) do nothing;");
    expect(week).toContain("v_priority smallint := case when p_trigger = 'button' then 15 else 40 end;");
    expect(week).toContain("to_char(current_date, 'YYYY-MM-DD'), v_priority - 1, now()) on conflict (dedupe_key) do nothing;");
    expect(sql).toContain("revoke all on function public.voice_profile_request(uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.voice_profile_request(uuid) to service_role;");
  });

  it("restates calendar_request_week with one refusal added, and its grants", () => {
    const was = earlier("20261110100000_calendar_plan_cancel.sql", "calendar_request_week");
    const now = definition(sql, "calendar_request_week");
    const added = " if public.client_strategy_only(p_client) then raise exception 'This client is set up for strategy only, so its calendar is not planned until its social accounts are connected.'; end if;";
    expect(now.args).toBe(was.args);
    expect(now.head).toBe(was.head);
    expect(now.body.split(added)).toHaveLength(2);
    expect(now.body.replace(added, "")).toBe(was.body);
    // Right after the archived client's refusal, before anything is written.
    expect(now.body).toContain(`raise exception 'This client is archived, so its calendar is not planned.'; end if;${added} insert into calendar_plans`);
    expect(sql).toContain("revoke all on function public.calendar_request_week(uuid, date, text, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.calendar_request_week(uuid, date, text, uuid) to service_role;");
  });

  it("restates calendar_request_revision with one refusal added, and its grants", () => {
    const was = earlier("20261118110000_calendar_replan.sql", "calendar_request_revision");
    const now = definition(sql, "calendar_request_revision");
    const added = " if exists (select 1 from calendar_plans p where p.id = p_plan and public.client_strategy_only(p.client_id)) then raise exception 'This client is set up for strategy only, so its calendar is not revised until its social accounts are connected.'; end if;";
    expect(now.args).toBe(was.args);
    expect(now.head).toBe(was.head);
    expect(now.body.replace(added, "")).toBe(was.body);
    expect(now.body).toContain(`raise exception 'Say what should change.'; end if;${added} update calendar_plans`);
    expect(sql).toContain("revoke all on function public.calendar_request_revision(uuid, text, uuid, text) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.calendar_request_revision(uuid, text, uuid, text) to service_role;");
  });

  it("restates the daily run with the one condition in the five places it starts a report or a plan, and nowhere else", () => {
    const was = earlier("20261019190000_calendar_self_serve.sql", "enqueue_scheduled_report_jobs");
    const now = definition(sql, "enqueue_scheduled_report_jobs");
    expect(now.args).toBe(was.args);
    expect(now.head).toBe(was.head);
    expect(now.body.split(GATE)).toHaveLength(6);
    expect(now.body.split(GATE).join("")).toBe(was.body);
    // The due schedules, the Monday plans, the plan retries, the copy fills and the revision retries.
    expect(now.body).toContain(`where s.is_active and s.next_run_at <= p_now and c.archived_at is null${GATE} )`);
    expect(now.body).toContain(`where c.archived_at is null and not coalesce(c.exclude_from_reporting, false)${GATE} and not exists (select 1 from public.calendar_plans p where p.client_id = c.id and p.week_start = v_week)`);
    expect(now.body).toContain(`and c.archived_at is null${GATE} and not exists (select 1 from public.scheduled_jobs j where j.kind = 'week_plan'`);
    expect(now.body).toContain(`where p.status = 'ready' and p.pending_revision is null and c.archived_at is null${GATE} and exists (select 1 from public.calendar_posts cp`);
    expect(now.body).toContain(`and c.archived_at is null${GATE} and not exists (select 1 from public.scheduled_jobs j where j.kind = 'week_revise'`);
    // The competitor feed and the daily lifecycle look, which the strategy reads, are queued for every client as before.
    expect(now.body).toContain("select 'lifecycle', c.id, null::uuid, null::timestamptz, 'lifecycle:' || c.id || ':' || to_char(p_now at time zone 'UTC', 'YYYY-MM-DD'), 45::smallint, 0, 'daily' from public.clients c where c.archived_at is null )");
    expect(sql).toContain("grant execute on function public.enqueue_scheduled_report_jobs(timestamptz, boolean) to service_role;");
  });

  it("restates the weekly trends enqueue and the gaps check with the one condition each", () => {
    const trendsWas = earlier("20261113101501_trend_past_weeks_close.sql", "enqueue_trend_refresh_jobs");
    const trends = definition(sql, "enqueue_trend_refresh_jobs");
    expect(trends.args).toBe(trendsWas.args);
    expect(trends.head).toBe(trendsWas.head);
    expect(trends.body.split(GATE)).toHaveLength(2);
    expect(trends.body.replace(GATE, "")).toBe(trendsWas.body);
    expect(trends.body).toContain(`and c.demo_job_id is null${GATE} and (`);
    const gapsWas = earlier("20261006150000_scheduled_report_queue.sql", "scheduled_report_gaps");
    const gaps = definition(sql, "scheduled_report_gaps");
    expect(gaps.args).toBe(gapsWas.args);
    expect(gaps.head).toBe(gapsWas.head);
    expect(gaps.body.replace(GATE, "")).toBe(gapsWas.body);
    expect(sql).toContain("grant execute on function public.enqueue_trend_refresh_jobs(timestamptz, boolean) to service_role;");
    expect(sql).toContain("grant execute on function public.scheduled_report_gaps(timestamptz) to service_role;");
  });

  it("refuses in words a client's own user can read: no refusal names Sprout", () => {
    for (const m of sql.matchAll(/raise exception '([^']*strategy only[^']*)'/g)) expect(m[1]).not.toMatch(/Sprout/);
    expect([...sql.matchAll(/raise exception '([^']*strategy only[^']*)'/g)]).toHaveLength(2);
  });

  it("restates each function from its latest definition: no migration after those defines them", () => {
    const files = (name: string) => readdirSync(migrations).filter((f) => f.endsWith(".sql") && new RegExp(`create (or replace )?function +(public\\.)?${name} *\\(`, "i").test(readFileSync(join(migrations, f), "utf8"))).sort();
    expect(files("calendar_request_week").slice(-2)).toEqual(["20261110100000_calendar_plan_cancel.sql", FILE]);
    expect(files("calendar_request_revision").slice(-2)).toEqual(["20261118110000_calendar_replan.sql", FILE]);
    expect(files("enqueue_scheduled_report_jobs").slice(-2)).toEqual(["20261019190000_calendar_self_serve.sql", FILE]);
    expect(files("enqueue_trend_refresh_jobs").slice(-2)).toEqual(["20261113101501_trend_past_weeks_close.sql", FILE]);
    expect(files("scheduled_report_gaps")).toEqual(["20261006150000_scheduled_report_queue.sql", FILE]);
  });
});

// ── Applied and run ─────────────────────────────────────────────────────────

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
/** In Sprout; strategy-only with no account at all; strategy-only with only a switched-off account; a demo copy with no account. */
const IN = id(1), ONLY = id(2), OFF = id(3), DEMO = id(4);
const NOW = "2026-11-23T07:15:00Z"; // a Monday morning, when the daily run plans the following week
const NEXT_WEEK = "2026-11-30";
const RETRY_WEEK = "2026-11-23", FILL_WEEK = "2026-12-07", REVISE_WEEK = "2026-12-14";

// The tables as far as the functions read and write them; auth.role, auth.uid and can_access_client stand in for the project's own.
const SETUP = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create function public.can_access_client(_client_id uuid) returns boolean language sql stable as $$
  select coalesce(current_setting('test.sees', true), '') = 'all' or _client_id::text = any (string_to_array(coalesce(current_setting('test.sees', true), ''), ',')) $$;
create table public.clients (id uuid primary key, name text not null, archived_at timestamptz, exclude_from_reporting boolean, demo_job_id uuid, social_voice jsonb, timezone text);
create table public.sprout_profiles (id uuid primary key default gen_random_uuid(), client_id uuid not null, sprout_profile_id bigint not null, is_active boolean default true, parked_at timestamptz);
create table public.report_schedules (id uuid primary key default gen_random_uuid(), client_id uuid not null, report_kind text not null, is_active boolean not null default true, next_run_at timestamptz, created_at timestamptz not null default now());
create table public.competitor_sets (id uuid primary key default gen_random_uuid(), client_id uuid not null, status text, rivaliq_landscape_id text, confirmed_at timestamptz, created_at timestamptz not null default now());
create table public.rivaliq_snapshots (client_id uuid, endpoint text, fetched_at timestamptz);
create table public.scheduled_jobs (id uuid primary key default gen_random_uuid(), kind text not null, client_id uuid, schedule_id uuid, occurrence timestamptz, dedupe_key text unique,
  priority smallint, stagger_seconds integer default 0, status text not null default 'queued', available_at timestamptz, lease_until timestamptz, payload jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.calendar_plans (id uuid primary key default gen_random_uuid(), client_id uuid not null, week_start date not null, trigger text, requested_by uuid, status text not null default 'queued',
  error text, pending_revision jsonb, revisions jsonb, ready_at timestamptz, canceled_at timestamptz, canceled_by uuid, claimed_at timestamptz, updated_at timestamptz default now(), unique (client_id, week_start));
create table public.calendar_posts (id uuid primary key default gen_random_uuid(), plan_id uuid, client_id uuid, post_date date, copy text);
create table public.trend_profiles (client_id uuid primary key);
create table public.trend_weeks (id uuid primary key default gen_random_uuid(), client_id uuid not null, week_start date not null, status text not null, finished_at timestamptz, created_at timestamptz not null default now());
create table public.report_pipeline_runs (id uuid primary key default gen_random_uuid(), real_id uuid, status text not null);
create function public.feed_refresh_weekday(c uuid) returns int language sql as $$ select 1 $$;
`;

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(SETUP);
  await db.exec(raw);
  await db.exec(raw);
}, 60_000);
afterAll(async () => { await db.close(); });

const account = (client: string, n: number, active = true, parked = false) =>
  db.query("insert into public.sprout_profiles (client_id, sprout_profile_id, is_active, parked_at) values ($1, $2, $3, $4)", [client, n, active, parked ? "2026-11-17T09:00:00Z" : null]);
const one = async <T>(query: string, params: unknown[] = []) => (await db.query<T>(query, params)).rows[0];
const bool = async (fn: string, client: string) => (await one<{ v: boolean }>(`select public.${fn}($1) as v`, [client])).v;
const as = (role: string, sees: string) => db.exec(`set test.role = '${role}'; set test.sees = '${sees}';`);

beforeEach(async () => {
  await db.exec("truncate public.clients, public.sprout_profiles, public.report_schedules, public.competitor_sets, public.rivaliq_snapshots, public.scheduled_jobs, public.calendar_plans, public.calendar_posts, public.trend_profiles, public.trend_weeks, public.report_pipeline_runs");
  await as("service_role", "");
  await db.query("insert into public.clients (id, name, demo_job_id, social_voice) values ($1, 'Harbor Lane', null, '{\"built_at\":\"2026-11-20T08:00:00Z\"}'), ($2, 'Pine Street Labs', null, null), ($3, 'Quiet Mill', null, null), ($4, 'Demo of Harbor Lane', $5, null)", [IN, ONLY, OFF, DEMO, id(90)]);
  await account(IN, 101);
  await account(OFF, 301, false);
});

describe("the one definition", () => {
  it("in Sprout is an active account: none, or only a switched-off one, is not", async () => {
    expect(await bool("client_in_sprout", IN)).toBe(true);
    expect(await bool("client_in_sprout", ONLY)).toBe(false);
    expect(await bool("client_in_sprout", OFF)).toBe(false);
    expect(await bool("client_in_sprout", id(77))).toBe(false);
  });

  it("a client whose second account on a network was set aside is in Sprout by the account it kept", async () => {
    await account(IN, 102, false, true);
    expect(await bool("client_in_sprout", IN)).toBe(true);
    expect(await bool("client_strategy_only", IN)).toBe(false);
    // Only set-aside accounts and no kept one: nothing is read from or posted to, so it is not in Sprout.
    await account(ONLY, 201, false, true);
    expect(await bool("client_strategy_only", ONLY)).toBe(true);
  });

  it("strategy-only is a client with no active account, never a demo copy and never a client that is not there", async () => {
    expect(await bool("client_strategy_only", ONLY)).toBe(true);
    expect(await bool("client_strategy_only", OFF)).toBe(true);
    expect(await bool("client_strategy_only", IN)).toBe(false);
    expect(await bool("client_strategy_only", DEMO)).toBe(false);
    expect(await bool("client_strategy_only", id(77))).toBe(false);
  });

  it("changes the moment an account is connected, and back when its last one goes: nothing is stored", async () => {
    await account(ONLY, 202);
    expect(await bool("client_strategy_only", ONLY)).toBe(false);
    await db.query("update public.sprout_profiles set is_active = false where client_id = $1", [ONLY]);
    expect(await bool("client_strategy_only", ONLY)).toBe(true);
    await db.query("delete from public.sprout_profiles where client_id = $1", [IN]);
    expect(await bool("client_strategy_only", IN)).toBe(true);
  });

  it("the screens' list holds the strategy-only clients the caller can see, and no others", async () => {
    const list = async () => (await db.query<{ c: string }>("select strategy_only_clients as c from public.strategy_only_clients() order by 1")).rows.map((r) => r.c);
    await as("authenticated", "all");
    expect(await list()).toEqual([ONLY, OFF]);
    await as("authenticated", `${IN},${OFF}`);
    expect(await list()).toEqual([OFF]);
    await as("authenticated", "");
    expect(await list()).toEqual([]);
    await as("service_role", "");
    expect(await list()).toEqual([ONLY, OFF]);
  });
});

/** Each client's week_plan and week_revise jobs, as "kind week" (the week's Monday, as the functions store it: midnight in the session's zone). */
const calendarJobs = async (client: string) => (await db.query<{ j: string }>(
  "select kind || ' ' || to_char(occurrence, 'YYYY-MM-DD') as j from public.scheduled_jobs where client_id = $1 and kind in ('week_plan', 'week_revise') order by 1", [client])).rows.map((r) => r.j);
const kinds = async (client: string) => (await db.query<{ kind: string }>("select distinct kind from public.scheduled_jobs where client_id = $1 order by 1", [client])).rows.map((r) => r.kind);
const plans = async (client: string) => (await db.query<{ p: string }>(
  "select to_char(week_start, 'YYYY-MM-DD') || ' ' || status || case when pending_revision is null then '' else ' revising' end as p from public.calendar_plans where client_id = $1 order by 1", [client])).rows.map((r) => r.p);
const enqueue = async () => (await one<{ r: Record<string, Array<{ client_id: string; kind?: string; detail?: string }>> }>("select public.enqueue_scheduled_report_jobs($1::timestamptz) as r", [NOW])).r;

/** What each client has before the daily run: due schedules, a plan with no job, a ready week with an empty post, a revision with no job, a tracked competitor set. */
async function standing() {
  for (const c of [IN, ONLY]) {
    await db.query("insert into public.report_schedules (client_id, report_kind, next_run_at) values ($1, 'social', '2026-11-07T07:15:00Z'), ($1, 'competitive', '2026-11-07T07:15:00Z')", [c]);
    await db.query("insert into public.competitor_sets (client_id, status, rivaliq_landscape_id, confirmed_at) values ($1, 'complete', '4411', '2026-11-01T00:00:00Z')", [c]);
    await db.query("insert into public.calendar_plans (client_id, week_start, trigger, status) values ($1, $2, 'monday', 'queued')", [c, RETRY_WEEK]);
    const fill = await one<{ id: string }>("insert into public.calendar_plans (client_id, week_start, trigger, status) values ($1, $2, 'button', 'ready') returning id", [c, FILL_WEEK]);
    await db.query("insert into public.calendar_posts (plan_id, client_id, post_date, copy) values ($1, $2, '2026-12-08', ''), ($1, $2, '2026-12-09', 'A planned post')", [fill.id, c]);
    await db.query("insert into public.calendar_plans (client_id, week_start, trigger, status, pending_revision) values ($1, $2, 'button', 'ready', '{\"note\":\"Shorter\",\"scope\":\"untouched\"}')", [c, REVISE_WEEK]);
  }
}

describe("the daily run", () => {
  it("starts nothing of a strategy-only client's calendar or reports, and everything of a client in Sprout", async () => {
    await standing();
    const result = await enqueue();
    // In Sprout: next week planned, the plan with no job asked again, the empty post filled, the waiting revision given a job, both reports dispatched.
    expect(await calendarJobs(IN)).toEqual([`week_plan ${RETRY_WEEK}`, `week_plan ${NEXT_WEEK}`, `week_revise ${FILL_WEEK}`, `week_revise ${REVISE_WEEK}`]);
    expect(await kinds(IN)).toEqual(["dispatch", "feed_refresh", "lifecycle", "week_plan", "week_revise"]);
    expect((await db.query("select 1 from public.scheduled_jobs where client_id = $1 and kind = 'dispatch'", [IN])).rows).toHaveLength(2);
    // Strategy-only: no plan, no revision, no dispatch. Its competitor feed and its lifecycle look, which the strategy reads, as before.
    expect(await calendarJobs(ONLY)).toEqual([]);
    expect(await kinds(ONLY)).toEqual(["feed_refresh", "lifecycle"]);
    for (const list of ["week_plans", "plan_retries", "revision_retries", "copy_fills"]) expect(result[list].map((x) => x.client_id)).not.toContain(ONLY);
    expect(result.enqueued.filter((x) => x.client_id === ONLY).map((x) => x.kind).sort()).toEqual(["feed_refresh", "lifecycle"]);
    // The other strategy-only client and the demo copy: a demo copy is planned as it was before.
    expect(await calendarJobs(OFF)).toEqual([]);
    expect(await calendarJobs(DEMO)).toEqual([`week_plan ${NEXT_WEEK}`]);
  });

  it("deletes and changes nothing a strategy-only client already has: its plans, posts and schedules stay as they are", async () => {
    await standing();
    const before = { plans: await plans(ONLY), posts: (await db.query("select * from public.calendar_posts where client_id = $1 order by post_date", [ONLY])).rows, schedules: (await db.query("select * from public.report_schedules where client_id = $1 order by report_kind", [ONLY])).rows };
    await enqueue();
    expect(await plans(ONLY)).toEqual([`${RETRY_WEEK} queued`, `${FILL_WEEK} ready`, `${REVISE_WEEK} ready revising`]);
    expect(await plans(ONLY)).toEqual(before.plans);
    expect((await db.query("select * from public.calendar_posts where client_id = $1 order by post_date", [ONLY])).rows).toEqual(before.posts);
    expect((await db.query("select * from public.report_schedules where client_id = $1 order by report_kind", [ONLY])).rows).toEqual(before.schedules);
  });

  it("plans, revises and dispatches for the client on the first run after it gets an account, with nobody doing anything", async () => {
    await standing();
    await enqueue();
    expect(await calendarJobs(ONLY)).toEqual([]);
    await account(ONLY, 203);
    const result = await enqueue();
    expect(await calendarJobs(ONLY)).toEqual([`week_plan ${RETRY_WEEK}`, `week_plan ${NEXT_WEEK}`, `week_revise ${FILL_WEEK}`, `week_revise ${REVISE_WEEK}`]);
    // Its schedules stayed due the whole time, so both reports are queued now.
    expect(result.enqueued.filter((x) => x.client_id === ONLY).map((x) => `${x.kind} ${x.detail}`).sort()).toEqual(["dispatch competitive", "dispatch social"]);
    // The client that was in Sprout all along got nothing a second time.
    expect(result.enqueued.filter((x) => x.client_id === IN)).toEqual([]);
    expect((await db.query("select 1 from public.scheduled_jobs where client_id = $1 and kind = 'dispatch'", [IN])).rows).toHaveLength(2);
  });

  it("does not count a strategy-only client's due schedule as a gap, and counts it once the client is in Sprout", async () => {
    await standing();
    const gaps = async () => (await db.query<{ client_id: string }>("select client_id from public.scheduled_report_gaps($1::timestamptz) order by 1", [NOW])).rows.map((r) => r.client_id);
    expect(await gaps()).toEqual([IN, IN]);
    await enqueue();
    expect(await gaps()).toEqual([]);
    await account(ONLY, 204);
    expect(await gaps()).toEqual([ONLY, ONLY]);
  });
});

describe("a plan or a revision asked for directly", () => {
  it("is refused for a strategy-only client in plain words, with nothing written, whoever asks", async () => {
    for (const trigger of ["button", "lifecycle", "monday"]) {
      await expect(db.query("select public.calendar_request_week($1, $2::date, $3, null)", [ONLY, NEXT_WEEK, trigger]))
        .rejects.toThrow("This client is set up for strategy only, so its calendar is not planned until its social accounts are connected.");
    }
    expect(await plans(ONLY)).toEqual([]);
    expect(await kinds(ONLY)).toEqual([]);
    const plan = await one<{ id: string }>("insert into public.calendar_plans (client_id, week_start, trigger, status) values ($1, $2, 'button', 'ready') returning id", [ONLY, FILL_WEEK]);
    for (const scope of ["untouched", "empty", "replan"]) {
      await expect(db.query("select public.calendar_request_revision($1, 'Shorter posts.', null, $2)", [plan.id, scope]))
        .rejects.toThrow("This client is set up for strategy only, so its calendar is not revised until its social accounts are connected.");
    }
    expect(await plans(ONLY)).toEqual([`${FILL_WEEK} ready`]);
    expect(await kinds(ONLY)).toEqual([]);
  });

  it("goes through as before for a client in Sprout, and for the other client once it has an account", async () => {
    await db.query("select public.calendar_request_week($1, $2::date, 'button', null)", [IN, NEXT_WEEK]);
    expect(await plans(IN)).toEqual([`${NEXT_WEEK} queued`]);
    expect(await calendarJobs(IN)).toEqual([`week_plan ${NEXT_WEEK}`]);
    const plan = await one<{ id: string }>("insert into public.calendar_plans (client_id, week_start, trigger, status) values ($1, $2, 'button', 'ready') returning id", [ONLY, FILL_WEEK]);
    await account(ONLY, 205);
    await db.query("select public.calendar_request_week($1, $2::date, 'lifecycle', null)", [ONLY, NEXT_WEEK]);
    await db.query("select public.calendar_request_revision($1, 'Shorter posts.', null, 'untouched')", [plan.id]);
    expect(await plans(ONLY)).toEqual([`${NEXT_WEEK} queued`, `${FILL_WEEK} ready revising`]);
    // A client with no voice profile gets one first, as before.
    expect(await kinds(ONLY)).toEqual(["voice_profile", "week_plan", "week_revise"]);
  });
});

describe("the weekly trends collection", () => {
  const due = async () => (await db.query<{ due_client: string }>("select due_client from public.enqueue_trend_refresh_jobs($1::timestamptz) order by 1", [NOW])).rows.map((r) => r.due_client);

  it("is not queued for a strategy-only client, whose trend profile stays for its strategy; it is for a client in Sprout", async () => {
    for (const c of [IN, ONLY, OFF]) await db.query("insert into public.trend_profiles (client_id) values ($1)", [c]);
    expect(await due()).toEqual([IN]);
    expect(await kinds(IN)).toEqual(["trend_refresh"]);
    expect(await kinds(ONLY)).toEqual([]);
    expect((await db.query("select 1 from public.trend_profiles")).rows).toHaveLength(3);
  });

  it("is queued on the first run after the client gets an account", async () => {
    for (const c of [IN, ONLY]) await db.query("insert into public.trend_profiles (client_id) values ($1)", [c]);
    expect(await due()).toEqual([IN]);
    await account(ONLY, 206);
    expect(await due()).toEqual([IN, ONLY]);
    expect(await kinds(ONLY)).toEqual(["trend_refresh"]);
  });

  it("still closes a strategy-only client's week that is over, as it closes any", async () => {
    await db.query("insert into public.trend_profiles (client_id) values ($1)", [ONLY]);
    await db.query("insert into public.trend_weeks (client_id, week_start, status, created_at) values ($1, '2026-11-16', 'running', '2026-11-17T00:00:00Z')", [ONLY]);
    expect(await due()).toEqual([]);
    expect((await one<{ status: string }>("select status from public.trend_weeks where client_id = $1", [ONLY])).status).toBe("partial");
  });
});

describe("a strategy-only client's voice profile", () => {
  const ask = async (client: string) => (await one<{ v: boolean }>("select public.voice_profile_request($1) as v", [client])).v;
  const voiceJobs = async (client: string) => (await db.query<{ dedupe_key: string; priority: number }>("select dedupe_key, priority from public.scheduled_jobs where client_id = $1 and kind = 'voice_profile'", [client])).rows;
  /** Whether this month's first Monday has come, by the database's own date. */
  const mondayCame = async () => (await one<{ v: boolean }>("select current_date >= (date_trunc('month', current_date)::date + ((8 - extract(isodow from date_trunc('month', current_date))::int) % 7)) as v")).v;
  const today = async () => (await one<{ d: string }>("select to_char(current_date, 'YYYY-MM-DD') as d")).d;

  it("is asked for when the client has none, once a day at most, as its first plan would have asked", async () => {
    expect(await ask(ONLY)).toBe(true);
    expect(await ask(ONLY)).toBe(true);
    expect(await voiceJobs(ONLY)).toEqual([{ dedupe_key: `voice_profile:${ONLY}:${await today()}`, priority: 39 }]);
    // No plan and no report come with it.
    expect(await kinds(ONLY)).toEqual(["voice_profile"]);
    expect(await plans(ONLY)).toEqual([]);
  });

  it("is left alone while it is current, and asked for again once it is from before this month's first Monday", async () => {
    await db.query("update public.clients set social_voice = jsonb_build_object('built_at', now()) where id = $1", [ONLY]);
    expect(await ask(ONLY)).toBe(false);
    expect(await voiceJobs(ONLY)).toEqual([]);
    await db.query("update public.clients set social_voice = '{\"built_at\":\"2026-01-05T08:00:00Z\"}' where id = $1", [ONLY]);
    const due = await mondayCame();
    expect(await ask(ONLY)).toBe(due);
    expect(await voiceJobs(ONLY)).toHaveLength(due ? 1 : 0);
  });

  it("asks under the key a plan request uses, so the two never ask twice in a day", async () => {
    // The client in Sprout with no voice profile: its plan asks for one first.
    await db.query("update public.clients set social_voice = null where id = $1", [IN]);
    await db.query("select public.calendar_request_week($1, $2::date, 'lifecycle', null)", [IN, NEXT_WEEK]);
    expect(await ask(IN)).toBe(true);
    expect(await voiceJobs(IN)).toEqual([{ dedupe_key: `voice_profile:${IN}:${await today()}`, priority: 39 }]);
  });

  it("asks nothing for an archived client, or one that is not there", async () => {
    await db.query("update public.clients set archived_at = now() where id = $1", [ONLY]);
    expect(await ask(ONLY)).toBe(false);
    expect(await ask(id(77))).toBe(false);
    expect(await voiceJobs(ONLY)).toEqual([]);
  });
});
