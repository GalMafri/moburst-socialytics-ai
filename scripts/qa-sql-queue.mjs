// The scheduled report queue's SQL, run against a real Postgres (PGlite).
// QA_SQL_MODULE points at a PGlite build when it is not installed locally.
const { PGlite } = await import(process.env.QA_SQL_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.clients(id uuid PRIMARY KEY, name text, archived_at timestamptz);
CREATE TABLE public.report_schedules(id uuid PRIMARY KEY, client_id uuid REFERENCES public.clients(id), report_kind text, is_active boolean, next_run_at timestamptz,
  pending_competitive_report_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.competitor_sets(id uuid PRIMARY KEY, client_id uuid, status text, confirmed_at timestamptz, rivaliq_landscape_id text, created_at timestamptz DEFAULT now());
CREATE TABLE public.rivaliq_snapshots(id serial PRIMARY KEY, client_id uuid, endpoint text, fetched_at timestamptz);
CREATE TABLE public.competitive_reports(id uuid PRIMARY KEY, status text);`);

const migration = readFileSync(new URL('../supabase/migrations/20261006150000_scheduled_report_queue.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // applies twice
// Feed refreshes only for clients whose current set is linked to a landscape.
const feedMigration = readFileSync(new URL('../supabase/migrations/20261014090000_feed_refresh_linked_landscapes_only.sql', import.meta.url), 'utf8');
await db.exec(feedMigration);
await db.exec(feedMigration);

const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
// A past tick, so the jobs it makes are already due for the lease checks below.
const NOW = '2026-09-09T07:15:00Z';
// Clients: 1 and 2 active with sets, 3 archived, 4 active without a set.
await db.exec(`INSERT INTO public.clients VALUES ('${id(1)}','Alpha',null),('${id(2)}','Beta',null),('${id(3)}','Gone','2026-01-01'),('${id(4)}','NoSet',null);
INSERT INTO public.report_schedules(id,client_id,report_kind,is_active,next_run_at,created_at) VALUES
 ('${id(11)}','${id(1)}','competitive',true,'2026-09-09T07:00:00Z','2026-01-01'),
 ('${id(12)}','${id(1)}','social',true,'2026-09-09T07:00:00Z','2026-01-01'),
 ('${id(21)}','${id(2)}','competitive',true,'2026-09-09T07:00:00Z','2026-01-02'),
 ('${id(22)}','${id(2)}','social',true,'2026-09-09T07:00:00Z','2026-01-02'),
 ('${id(31)}','${id(3)}','social',true,'2026-09-09T07:00:00Z','2026-01-03'),
 ('${id(41)}','${id(4)}','social',false,'2026-09-09T07:00:00Z','2026-01-04'),
 ('${id(42)}','${id(4)}','competitive',true,'2026-10-09T07:00:00Z','2026-01-04');
INSERT INTO public.competitor_sets VALUES ('${id(101)}','${id(1)}','complete'),('${id(102)}','${id(2)}','confirmed'),('${id(103)}','${id(3)}','complete'),('${id(104)}','${id(4)}','draft');
-- Alpha and Beta are linked to landscapes. Unlinked (5) has a set but no landscape; Relinked (6) has an older
-- linked set behind a newer unlinked one. Neither 5 nor 6 may get a feed refresh.
UPDATE public.competitor_sets SET rivaliq_landscape_id = 'landscape-' || right(client_id::text, 1), confirmed_at = '2026-08-01' WHERE id IN ('${id(101)}','${id(102)}');
INSERT INTO public.clients VALUES ('${id(5)}','Unlinked',null),('${id(6)}','Relinked',null);
INSERT INTO public.competitor_sets(id,client_id,status,confirmed_at,rivaliq_landscape_id) VALUES
 ('${id(105)}','${id(5)}','complete','2026-08-01',null),
 ('${id(106)}','${id(6)}','complete','2026-07-01','landscape-6'),
 ('${id(107)}','${id(6)}','confirmed','2026-09-01','  ');
INSERT INTO public.rivaliq_snapshots(client_id,endpoint,fetched_at) VALUES ('${id(1)}','feed','2026-09-01T07:00:00Z'),('${id(2)}','feed','2026-09-07T07:15:00Z'),('${id(2)}','metrics','2026-01-01');`);

const asService = async (sql) => { await db.exec('RESET ROLE; SET ROLE service_role'); try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); } };
const enqueue = (dry) => asService(`SELECT public.enqueue_scheduled_report_jobs('${NOW}', ${dry}) AS r`).then((r) => r[0].r);
const jobs = () => db.query(`SELECT kind, client_id, schedule_id, priority, stagger_seconds, status, dedupe_key FROM public.scheduled_jobs ORDER BY priority, dedupe_key`).then((r) => r.rows);

// Only the service role may call the functions or touch the table.
for (const role of ['anon', 'authenticated']) {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await assert.rejects(() => db.query(`SELECT public.enqueue_scheduled_report_jobs('${NOW}', true)`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT * FROM public.scheduled_jobs_lease(300)`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT public.release_ready_dispatches()`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT * FROM public.scheduled_jobs`), /permission denied/);
  await db.exec('RESET ROLE');
}

// Dry run: reports the plan, writes nothing.
const preview = await enqueue(true);
assert.equal(preview.dry_run, true);
assert.equal((await jobs()).length, 0, 'dry run wrote rows');
const plan = preview.enqueued.map((j) => `${j.kind}:${j.detail}:${j.client_id.slice(-1)}`);
// Alpha's feed is 8 days old: due. Beta's is two days old: due only when today is its weekday.
// Archived Gone and set-less NoSet never get a feed, nor do Unlinked and Relinked, whose current set has no
// landscape; inactive and future schedules never dispatch.
assert.deepEqual(plan.filter((p) => p.startsWith('dispatch')).sort(), ['dispatch:competitive:1', 'dispatch:competitive:2', 'dispatch:social:1', 'dispatch:social:2']);
const betaWeekday = (await db.query(`SELECT public.feed_refresh_weekday('${id(2)}') AS d`)).rows[0].d;
const expectBetaFeed = betaWeekday === new Date(NOW).getUTCDay();
assert.deepEqual(plan.filter((p) => p.startsWith('feed')).map((p) => p.slice(-1)).sort(), expectBetaFeed ? ['1', '2'] : ['1']);

// Real run writes the same plan, ordered feeds, then competitive, then social, with the old stagger.
const first = await enqueue(false);
assert.deepEqual(first.enqueued.map((j) => j.dedupe_key ?? j.kind).length, preview.enqueued.length);
const rows = await jobs();
assert.deepEqual(rows.map((r) => r.priority), [...rows.map((r) => r.priority)].sort((a, b) => a - b));
assert.deepEqual(rows.filter((r) => r.kind === 'dispatch').map((r) => [r.schedule_id.slice(-2), r.stagger_seconds]), [['11', 0], ['21', 150], ['12', 0], ['22', 180]]);
assert(rows.every((r) => r.status === 'queued'));

// Idempotent: a second tick the same day adds nothing.
const second = await enqueue(false);
assert.equal(second.enqueued.length, 0);
assert.equal((await jobs()).length, rows.length);

// Gaps: nothing is missing right after the tick; a due occurrence with no job, an hour on, is reported.
const gaps = (at) => asService(`SELECT schedule_id, report_kind FROM public.scheduled_report_gaps('${at}')`);
assert.equal((await gaps('2026-09-09T09:00:00Z')).length, 0);
await db.exec(`INSERT INTO public.report_schedules(id,client_id,report_kind,is_active,next_run_at) VALUES ('${id(13)}','${id(1)}','social',true,'2026-09-09T07:30:00Z')`);
assert.deepEqual((await gaps('2026-09-09T09:00:00Z')).map((g) => g.schedule_id.slice(-2)), ['13']);
assert.equal((await gaps('2026-09-09T08:00:00Z')).length, 0, 'reported before the hour of grace');
await db.exec(`DELETE FROM public.report_schedules WHERE id='${id(13)}'`);
await db.exec('RESET ROLE; SET ROLE authenticated');
await assert.rejects(() => db.query(`SELECT * FROM public.scheduled_report_gaps(now())`), /permission denied/);
await db.exec('RESET ROLE');

// Lease hands out one job at a time, best priority first, and never the same job twice while leased.
const leaseOne = () => asService(`SELECT id, kind, priority, attempts, status FROM public.scheduled_jobs_lease(300)`).then((r) => r[0] || null);
const a = await leaseOne();
assert.equal(a.priority, 10);
assert.equal(a.attempts, 1);
assert.equal(a.status, 'running');
const seen = new Set([a.id]);
for (let i = 1; i < rows.length; i++) { const j = await leaseOne(); assert(j && !seen.has(j.id)); seen.add(j.id); }
assert.equal(await leaseOne(), null, 'a leased job was handed out twice');

// An expired lease is handed out again with the attempt counted.
await db.exec(`UPDATE public.scheduled_jobs SET lease_until = now() - interval '1 second' WHERE id = '${a.id}'`);
const again = await leaseOne();
assert.equal(again.id, a.id);
assert.equal(again.attempts, 2);

// A job held until later is not handed out early.
await db.exec(`UPDATE public.scheduled_jobs SET status='queued', lease_until=null, available_at = now() + interval '10 minutes' WHERE id = '${a.id}'`);
assert.equal(await leaseOne(), null);

// The sweep releases a held social job once its pinned competitive report finishes, and only that one.
await db.exec(`UPDATE public.scheduled_jobs SET status='waiting', lease_until=null WHERE kind='dispatch' AND schedule_id IN ('${id(12)}','${id(22)}');
INSERT INTO public.competitive_reports VALUES ('${id(900)}','running'),('${id(901)}','running');
UPDATE public.report_schedules SET pending_competitive_report_id='${id(900)}' WHERE id='${id(12)}';
UPDATE public.report_schedules SET pending_competitive_report_id='${id(901)}' WHERE id='${id(22)}';`);
const sweep = () => asService(`SELECT public.release_ready_dispatches() AS n`).then((r) => r[0].n);
const dispatchStates = async () => Object.fromEntries((await db.query(`SELECT schedule_id, status FROM public.scheduled_jobs WHERE kind='dispatch'`)).rows.map((r) => [r.schedule_id.slice(-2), r.status]));
assert.equal(await sweep(), 0, 'released while the competitive report was still running');
await db.exec(`UPDATE public.competitive_reports SET status='complete' WHERE id='${id(900)}'`);
assert.equal(await sweep(), 1);
assert.equal((await dispatchStates())['12'], 'queued');
assert.equal((await dispatchStates())['22'], 'waiting');
// A failed competitive report releases a waiting job once (so it can record blocked), never a blocked one.
await db.exec(`UPDATE public.competitive_reports SET status='failed' WHERE id='${id(901)}'`);
assert.equal(await sweep(), 1);
await db.exec(`UPDATE public.scheduled_jobs SET status='blocked' WHERE schedule_id='${id(22)}'`);
assert.equal(await sweep(), 0);
// Retried and complete: the blocked job is released.
await db.exec(`UPDATE public.competitive_reports SET status='complete' WHERE id='${id(901)}'`);
assert.equal(await sweep(), 1);

// The daily tick releases every waiting or blocked dispatch for its recheck.
await db.exec(`UPDATE public.scheduled_jobs SET status='blocked' WHERE schedule_id='${id(22)}'`);
await db.exec(`UPDATE public.competitive_reports SET status='failed' WHERE id='${id(901)}'`);
const third = await enqueue(false);
assert.equal(third.released, 1);
assert.equal((await db.query(`SELECT status FROM public.scheduled_jobs WHERE schedule_id='${id(22)}'`)).rows[0].status, 'queued');

// Deleting a schedule removes its jobs; deleting nothing else is required.
await db.exec(`DELETE FROM public.scheduled_jobs WHERE schedule_id='${id(22)}'; DELETE FROM public.report_schedules WHERE id='${id(22)}'`);

// The weekday is stable and in range.
const days = (await db.query(`SELECT public.feed_refresh_weekday(id) AS d FROM public.clients`)).rows.map((r) => r.d);
assert(days.every((d) => d >= 0 && d <= 6));
assert.equal((await db.query(`SELECT public.feed_refresh_weekday('${id(1)}') = public.feed_refresh_weekday('${id(1)}') AS same`)).rows[0].same, true);

// ── Sprout auto-onboarding (20261108130000_sprout_auto_onboarding.sql) ──────
// The columns and tables it reads, then two triggers standing in for the real
// ones on clients, so the website backfill is seen to change nothing else.
await db.exec(`ALTER TABLE public.clients ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.clients ADD COLUMN website_url text, ADD COLUMN field_sources jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN demo_job_id uuid, ADD COLUMN created_by uuid, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT '2026-01-01T00:00:00Z';
CREATE TABLE public.sprout_profiles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  sprout_profile_id bigint NOT NULL, profile_name text DEFAULT '', native_name text DEFAULT '', network_type text NOT NULL, native_link text DEFAULT '',
  is_active boolean DEFAULT true, assigned_at timestamptz DEFAULT now(), UNIQUE(client_id, sprout_profile_id));
CREATE TABLE public.sprout_profile_removals(client_id uuid NOT NULL, sprout_profile_id bigint NOT NULL, removed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (client_id, sprout_profile_id));
CREATE FUNCTION public.lifecycle_tracked_fields() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ select array['brand_identity'] $$;
UPDATE public.clients SET website_url = 'https://www.alpha.example/' WHERE id = '${id(1)}';
UPDATE public.clients SET website_url = '  ' WHERE id = '${id(2)}';
UPDATE public.clients SET website_url = 'https://gone.example', field_sources = '{"website_url": {"by": "lifecycle"}}' WHERE id = '${id(3)}';
CREATE FUNCTION public.qa_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.qa_touch();
CREATE FUNCTION public.qa_look() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO public.scheduled_jobs(kind, client_id, dedupe_key) VALUES ('feed_refresh', NEW.id, 'look:' || NEW.id || ':' || clock_timestamp()); RETURN NEW; END $$;
CREATE TRIGGER clients_lifecycle AFTER UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.qa_look();`);
const before = (await db.query(`SELECT id, name, website_url, archived_at, updated_at::text AS updated_at FROM public.clients ORDER BY id`)).rows;
const jobsBefore = (await db.query(`SELECT count(*)::int AS n FROM public.scheduled_jobs`)).rows[0].n;
const onboarding = readFileSync(new URL('../supabase/migrations/20261108130000_sprout_auto_onboarding.sql', import.meta.url), 'utf8');
await db.exec(onboarding);
await db.exec(onboarding); // applies twice

// The backfill: every website a client has now is marked as set by a person; nothing else on any row, and no trigger, moves.
const sources = Object.fromEntries((await db.query(`SELECT id, field_sources FROM public.clients`)).rows.map((r) => [r.id.slice(-1), r.field_sources]));
assert.equal(sources['1'].website_url.by, 'person');
assert.equal(sources['2'].website_url, undefined, 'a blank website was marked');
assert.equal(sources['3'].website_url.by, 'lifecycle', 'an existing marker was replaced');
assert.equal(sources['4'].website_url, undefined);
assert.deepEqual((await db.query(`SELECT id, name, website_url, archived_at, updated_at::text AS updated_at FROM public.clients ORDER BY id`)).rows, before);
assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.scheduled_jobs`)).rows[0].n, jobsBefore, 'the backfill set off a trigger');
assert.deepEqual((await db.query(`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'public.clients'::regclass AND NOT tgisinternal ORDER BY tgname`)).rows,
  [{ tgname: 'clients_lifecycle', tgenabled: 'O' }, { tgname: 'update_clients_updated_at', tgenabled: 'O' }]);
assert((await db.query(`SELECT public.lifecycle_tracked_fields() AS f`)).rows[0].f.includes('website_url'));
assert((await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'clients' AND column_name = 'origin'`)).rows.length === 1);

// Only the Sprout onboarding job may belong to no client.
await assert.rejects(() => db.query(`INSERT INTO public.scheduled_jobs(kind, client_id, dedupe_key) VALUES ('feed_refresh', null, 'qa:no-client')`), /scheduled_jobs_client_required/);
await db.exec(`DROP TRIGGER clients_lifecycle ON public.clients; DROP TRIGGER update_clients_updated_at ON public.clients;`);

// Only the service role reaches the two functions.
for (const role of ['anon', 'authenticated']) {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await assert.rejects(() => db.query(`SELECT public.enqueue_sprout_onboarding_job(now(), true)`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT public.sprout_onboard_client('X', null, '[{"id":"1","network_type":"facebook"}]')`), /permission denied/);
  await db.exec('RESET ROLE');
}

// The enqueue: on a Monday (Israel time) one job a day; a dry run inserts nothing; not again while one is open, nor the
// day after a run finished; after 8 days with no finished run, on any day.
const onboardJobs = () => db.query(`SELECT dedupe_key, client_id, status, priority FROM public.scheduled_jobs WHERE kind = 'sprout_onboarding' ORDER BY dedupe_key`).then((r) => r.rows);
const enqueueOnboarding = (at, dry = false) => asService(`SELECT public.enqueue_sprout_onboarding_job('${at}', ${dry}) AS r`).then((r) => r[0].r);
const MONDAY = '2026-11-09T06:00:00Z';
assert.equal((await enqueueOnboarding(MONDAY, true)).due, true);
assert.equal((await onboardJobs()).length, 0, 'the dry run inserted a job');
assert.equal((await enqueueOnboarding(MONDAY)).queued, true);
assert.equal((await enqueueOnboarding('2026-11-09T09:00:00Z')).queued, false);
assert.deepEqual(await onboardJobs(), [{ dedupe_key: 'sprout_onboarding:2026-11-09', client_id: null, status: 'queued', priority: 50 }]);
await db.exec(`UPDATE public.scheduled_jobs SET status = 'done', finished_at = '2026-11-09T06:02:00Z' WHERE kind = 'sprout_onboarding'`);
assert.equal((await enqueueOnboarding('2026-11-10T06:00:00Z')).due, false, 'queued the day after a finished run');
assert.equal((await enqueueOnboarding('2026-11-16T06:00:00Z', true)).due, true, 'the next Monday is due');
// The next Monday's run fails; the Tuesday after, 8 days since the last finished run, catches it up.
await db.exec(`INSERT INTO public.scheduled_jobs(kind, client_id, dedupe_key, status, finished_at) VALUES ('sprout_onboarding', null, 'sprout_onboarding:2026-11-16', 'failed', '2026-11-16T06:20:00Z')`);
assert.equal((await enqueueOnboarding('2026-11-17T06:00:00Z')).queued, true);
assert.equal((await enqueueOnboarding('2026-11-18T06:00:00Z', true)).due, false, 'due while a run is still queued');

// sprout_onboard_client: one client with its name, website (as the lifecycle's), origin and profiles; refused for a
// profile already assigned or removed, so overlapping runs create one client.
const onboard = (name, website, profiles, brand = null) => asService(`SELECT public.sprout_onboard_client(${name === null ? 'null' : `'${name}'`}, ${website ? `'${website}'` : 'null'}, '${JSON.stringify(profiles)}'::jsonb${brand ? `, '${brand}'` : ''}) AS r`).then((r) => r[0].r);
const OLO = [{ id: '7001', name: 'Olo', native_name: 'olo', network_type: 'linkedin_company', native_link: 'https://www.linkedin.com/company/olo' }, { id: '7002', name: 'Olo', native_name: 'olo.hq', network_type: 'fb_instagram_account' }];
const made = await onboard('Olo', 'https://www.olo.com', OLO);
assert.equal(made.created, true);
const olo = (await db.query(`SELECT name, website_url, field_sources, origin, created_by FROM public.clients WHERE id = '${made.client_id}'`)).rows[0];
assert.equal(olo.name, 'Olo');
assert.equal(olo.website_url, 'https://www.olo.com');
assert.equal(olo.field_sources.website_url.by, 'lifecycle');
assert.equal(olo.created_by, null);
assert.deepEqual({ ...olo.origin, at: undefined }, { source: 'sprout', brand: 'Olo', profile_ids: [7001, 7002], at: undefined });
assert.deepEqual((await db.query(`SELECT sprout_profile_id::text AS id, profile_name, native_name, network_type, is_active FROM public.sprout_profiles WHERE client_id = '${made.client_id}' ORDER BY 1`)).rows,
  [{ id: '7001', profile_name: 'Olo', native_name: 'olo', network_type: 'linkedin_company', is_active: true }, { id: '7002', profile_name: 'Olo', native_name: 'olo.hq', network_type: 'fb_instagram_account', is_active: true }]);
const overlap = await onboard('Olo', 'https://www.olo.com', [OLO[1], { id: '7003', name: 'Olo', network_type: 'tiktok' }]);
assert.deepEqual(overlap, { created: false, reason: 'assigned', client_id: made.client_id });
await db.exec(`INSERT INTO public.sprout_profile_removals(client_id, sprout_profile_id) VALUES ('${id(1)}', 7100)`);
assert.deepEqual(await onboard('Alpha Two', null, [{ id: '7100', name: 'Alpha Two', network_type: 'facebook' }]), { created: false, reason: 'removed', client_id: id(1) });
const bare = await onboard('Yangra', null, [{ id: '7200', name: 'Yangra ', network_type: 'facebook' }], 'Yangra ');
assert.deepEqual((await db.query(`SELECT website_url, field_sources FROM public.clients WHERE id = '${bare.client_id}'`)).rows[0], { website_url: null, field_sources: {} });
assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.clients WHERE name IN ('Olo', 'Alpha Two', 'Yangra')`)).rows[0].n, 2);
await assert.rejects(() => onboard('Nameless', null, []), /needs its profiles/);
await assert.rejects(() => onboard('Bad', null, [{ id: 'x', network_type: 'facebook' }]), /Sprout id/);

await db.close();
console.log('PASS: queue migration applies twice; feeds are queued only for clients whose current set is linked to a landscape; only service_role reaches it; dry run writes nothing; enqueue is idempotent and ordered with the old stagger; lease is exclusive and counts attempts; the sweep releases only social jobs whose competitive report finished; the daily tick rechecks waiting and blocked jobs; overdue schedules with no job are reported; Sprout onboarding: the migration applies twice, marks existing websites as set by a person and changes nothing else, only its job may have no client, enqueue runs Mondays and after 8 idle days at most once a day with a dry run that inserts nothing, and the onboarding function makes one client and refuses an assigned or removed profile.');
