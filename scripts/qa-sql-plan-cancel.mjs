// Stopping a week's plan (20261110100000_calendar_plan_cancel.sql), run
// against a real Postgres (PGlite). The tables are reduced to the columns the
// migration reads and writes; calendar_post_worked and is_oauth_session are
// the migrations' own definitions. QA_SQL_MODULE points at a PGlite build
// when it is not installed locally.
const { PGlite } = await import(process.env.QA_SQL_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const migration = (file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
/** One function's definition, with its grants, as a migration states it. */
const definition = (file, name) => {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  const end = sql.indexOf('$$;', sql.indexOf('$$', sql.indexOf('$$', start) + 2)) + 3;
  return sql.slice(start, end);
};

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ select auth.jwt()->>'role' $$;
CREATE FUNCTION public.is_moburst_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ select false $$;
CREATE FUNCTION public.is_client_member(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ select false $$;
CREATE TABLE public.clients(id uuid PRIMARY KEY, name text, archived_at timestamptz, timezone text, social_voice jsonb);
CREATE TABLE public.calendar_plans(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id), week_start date NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','planning','ready','failed','expired')), trigger text NOT NULL, requested_by uuid,
  revisions jsonb NOT NULL DEFAULT '[]'::jsonb, pending_revision jsonb, error text, claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), ready_at timestamptz, UNIQUE (client_id, week_start));
CREATE TABLE public.calendar_posts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL, post_date date NOT NULL, platform text NOT NULL,
  copy text NOT NULL DEFAULT '', source text NOT NULL DEFAULT 'ad_hoc', post_key text, touched_at timestamptz,
  plan_id uuid REFERENCES public.calendar_plans(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION public.calendar_posts_fill_key() RETURNS trigger LANGUAGE plpgsql AS $$
begin if new.post_key is null or new.post_key = '' then new.post_key := 'post:' || new.id::text; end if; new.updated_at := now(); return new; end $$;
CREATE TRIGGER calendar_posts_fill_key BEFORE INSERT OR UPDATE ON public.calendar_posts FOR EACH ROW EXECUTE FUNCTION public.calendar_posts_fill_key();
-- The archive was made like calendar_posts before Stories added story_of (20261109140000_stories.sql).
CREATE TABLE public.calendar_posts_archive (LIKE public.calendar_posts);
ALTER TABLE public.calendar_posts_archive ADD COLUMN archived_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN archive_reason text;
ALTER TABLE public.calendar_posts ADD COLUMN story_of text;
CREATE TABLE public.scheduled_jobs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, client_id uuid NOT NULL, occurrence timestamptz,
  dedupe_key text NOT NULL UNIQUE, priority smallint NOT NULL DEFAULT 50, status text NOT NULL DEFAULT 'queued', reason text,
  available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.post_iterations(client_id uuid, calendar_post_key text);
CREATE TABLE public.design_requests(client_id uuid, calendar_post_key text, status text);
CREATE TABLE public.scheduled_posts(client_id uuid, platform text, post_content text, calendar_post_key text);`);
// The service role reads and writes every table, as in Supabase.
await db.exec(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role; GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
await db.exec(definition('20261109120000_claude_connector.sql', 'is_oauth_session'));
await db.exec(definition('20261109100000_client_notes.sql', 'calendar_post_worked'));

const sql = migration('20261110100000_calendar_plan_cancel.sql');
await db.exec(sql);
await db.exec(sql); // applies twice

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const CLIENT = id(1);
const PERSON = id(9);
const asService = () => db.exec(`RESET ROLE; SET request.jwt.claims = '{"role":"service_role"}'; SET ROLE service_role;`);
const asOwner = () => db.exec(`RESET ROLE;`);
const one = async (q, params) => (await db.query(q, params)).rows[0];
const weekAhead = (n) => one(`select (date_trunc('week', current_date)::date + ${7 * n})::text as w`).then((r) => r.w);
const plan = (w) => one(`select * from public.calendar_plans where client_id = $1 and week_start = $2`, [CLIENT, w]);
const jobs = (w, kind = 'week_plan') => db.query(`select status, reason, dedupe_key from public.scheduled_jobs where kind = $1 and client_id = $2 and occurrence = $3::date::timestamptz order by created_at, dedupe_key`, [kind, CLIENT, w]).then((r) => r.rows);
const stop = (planId) => one(`select * from public.calendar_stop_plan($1, $2)`, [planId, PERSON]);

await asOwner();
await db.exec(`INSERT INTO public.clients VALUES ('${CLIENT}', 'Pay The Pyper', null, 'America/New_York', '{"built_at":"2099-01-01T00:00:00Z"}');`);
const NEXT = await weekAhead(1);
const LATER = await weekAhead(2);

// Only the service role reaches it; a connected app is refused even there.
await db.exec('SET ROLE authenticated');
await assert.rejects(() => db.query(`select public.calendar_stop_plan('${id(5)}')`), /permission denied/);
await db.exec(`RESET ROLE; SET request.jwt.claims = '{"role":"service_role","client_id":"claude"}'; SET ROLE service_role;`);
await assert.rejects(() => db.query(`select public.calendar_stop_plan('${id(5)}')`), /Connected apps can read Socialytics but cannot change it/);
await asService();
await assert.rejects(() => stop(id(5)), /No such plan/);

// 1. "Plan next week" pressed by accident, stopped while queued: the job closes, the week has no plan, nothing is written.
const queued = await one(`select * from public.calendar_request_week($1, $2, 'button', $3)`, [CLIENT, NEXT, PERSON]);
assert.equal(queued.status, 'queued');
assert.deepEqual((await jobs(NEXT)).map((j) => j.status), ['queued']);
const stopped = await stop(queued.id);
assert.equal(stopped.status, 'canceled');
assert.equal(stopped.canceled_by, PERSON);
assert.ok(stopped.canceled_at);
assert.deepEqual(await jobs(NEXT), [{ status: 'skipped', reason: 'Stopped by a person.', dedupe_key: `week_plan:${CLIENT}:${NEXT}` }]);
// A second press answers with the plan as it is.
assert.equal((await stop(queued.id)).canceled_at.getTime(), stopped.canceled_at.getTime());

// 2. A run that is past its check writes nothing into a plan that was stopped.
await assert.rejects(() => db.query(`insert into public.calendar_posts (client_id, post_date, platform, copy, source, plan_id) values ($1, $2, 'Instagram', 'Late post', 'plan', $3)`, [CLIENT, NEXT, queued.id]),
  /plan was stopped, so it takes no posts/);
assert.equal((await one(`select count(*)::int as n from public.calendar_posts`)).n, 0);
// Posts people add to the week are untouched by the rule.
await db.query(`insert into public.calendar_posts (client_id, post_date, platform, copy) values ($1, $2, 'LinkedIn', 'Added by a person')`, [CLIENT, NEXT]);

// 3. No automatic run plans a stopped week again; a person's own press does.
for (const trigger of ['monday', 'lifecycle']) {
  assert.equal((await one(`select * from public.calendar_request_week($1, $2, $3, null)`, [CLIENT, NEXT, trigger])).status, 'canceled');
}
assert.equal((await jobs(NEXT)).length, 1);
const again = await one(`select * from public.calendar_request_week($1, $2, 'button', $3)`, [CLIENT, NEXT, PERSON]);
assert.equal(again.id, queued.id);
assert.equal(again.status, 'queued');
assert.equal(again.canceled_at, null);
assert.deepEqual((await jobs(NEXT)).map((j) => [j.status, j.dedupe_key]), [['skipped', `week_plan:${CLIENT}:${NEXT}`], ['queued', `week_plan:${CLIENT}:${NEXT}:1`]]);

// 4. Stopped while its run was writing, after the run added its posts: they leave with the plan.
await asOwner();
await db.query(`update public.calendar_plans set status = 'planning', claimed_at = now() where id = $1`, [queued.id]);
await db.query(`update public.scheduled_jobs set status = 'running' where dedupe_key = $1`, [`week_plan:${CLIENT}:${NEXT}:1`]);
await asService();
await db.query(`insert into public.calendar_posts (id, client_id, post_date, platform, copy, source, plan_id) values ($1, $2, $3, 'Instagram', 'Planned post', 'plan', $4)`, [id(101), CLIENT, NEXT, queued.id]);
const midRun = await stop(queued.id);
assert.equal(midRun.status, 'canceled');
assert.equal(midRun.claimed_at, null);
assert.deepEqual((await jobs(NEXT)).map((j) => j.status), ['skipped', 'skipped']);
assert.deepEqual((await db.query(`select id from public.calendar_posts where plan_id is not null`)).rows, []);
assert.equal((await one(`select count(*)::int as n from public.calendar_posts_archive where id = $1`, [id(101)])).n, 1);
assert.equal((await one(`select count(*)::int as n from public.calendar_posts where copy = 'Added by a person'`)).n, 1);

// 5. A finished plan removed: the posts nobody worked on go to the archive, Stories whole; the rest stay, as posts of no plan.
const ready = await one(`select * from public.calendar_request_week($1, $2, 'button', $3)`, [CLIENT, LATER, PERSON]);
await asOwner();
await db.query(`update public.calendar_plans set status = 'ready', ready_at = now(), pending_revision = '{"note":"Less formal","by":"${PERSON}","scope":"untouched"}' where id = $1`, [ready.id]);
await db.query(`insert into public.scheduled_jobs (kind, client_id, occurrence, dedupe_key) values ('week_revise', $1, $2::date::timestamptz, 'week_revise:x')`, [CLIENT, LATER]);
await db.query(`insert into public.calendar_posts (id, client_id, post_date, platform, copy, source, plan_id, post_key, story_of, touched_at) values
  ($1, $5, $6, 'Instagram', 'Untouched', 'plan', $7, 'post:a', null, null),
  ($2, $5, $6, 'Instagram', 'Untouched', 'plan', $7, 'post:b', 'post:a', null),
  ($3, $5, $6, 'LinkedIn', 'Edited by a person', 'plan', $7, 'post:c', null, now()),
  ($4, $5, $6, 'TikTok', 'Design asked for', 'plan', $7, 'post:d', null, null)`, [id(201), id(202), id(203), id(204), CLIENT, LATER, ready.id]);
await db.query(`insert into public.design_requests values ($1, 'post:d', 'preparing')`, [CLIENT]);
await asService();
const removed = await stop(ready.id);
assert.equal(removed.status, 'canceled');
assert.equal(removed.pending_revision, null);
assert.equal(removed.ready_at !== null, true);
assert.equal(removed.revisions.at(-1).note, 'Less formal');
assert.ok(removed.revisions.at(-1).stopped_at);
assert.deepEqual((await jobs(LATER, 'week_revise')).map((j) => j.status), ['skipped']);
assert.deepEqual((await db.query(`select id, plan_id from public.calendar_posts where post_date = $1 order by id`, [LATER])).rows, [{ id: id(203), plan_id: null }, { id: id(204), plan_id: null }]);
const archived = (await db.query(`select id, story_of, archive_reason from public.calendar_posts_archive where id in ($1, $2) order by id`, [id(201), id(202)])).rows;
assert.deepEqual(archived.map((r) => [r.id, r.story_of]), [[id(201), null], [id(202), 'post:a']]);
assert.match(archived[0].archive_reason, /stopped or removed by a person/);

// 6. Only a plan on its way or a finished one with days to come.
await asOwner();
await db.query(`insert into public.calendar_plans (id, client_id, week_start, status, trigger, ready_at) values ($1, $2, '2026-01-05', 'ready', 'monday', now()), ($3, $2, '2026-01-12', 'expired', 'monday', null)`, [id(301), CLIENT, id(302)]);
await asService();
await assert.rejects(() => stop(id(301)), /This week is over, so its plan stays/);
await assert.rejects(() => stop(id(302)), /This week has no plan to stop/);
assert.equal((await plan('2026-01-05')).status, 'ready');

await db.close();
console.log('PASS: applies twice; only the service role, never a connected app; a queued plan stops with its job and stays stopped against automatic runs; a stopped plan takes no posts; a person plans it again; a run mid-write loses its posts; a finished plan is removed keeping the posts people worked on, Stories archived whole, the waiting revision kept as history; past and expired weeks refused.');
