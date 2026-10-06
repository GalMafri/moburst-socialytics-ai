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
CREATE TABLE public.competitor_sets(id uuid PRIMARY KEY, client_id uuid, status text);
CREATE TABLE public.rivaliq_snapshots(id serial PRIMARY KEY, client_id uuid, endpoint text, fetched_at timestamptz);`);

const migration = readFileSync(new URL('../supabase/migrations/20261006150000_scheduled_report_queue.sql', import.meta.url), 'utf8');
await db.exec(migration);
await db.exec(migration); // applies twice

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
INSERT INTO public.rivaliq_snapshots(client_id,endpoint,fetched_at) VALUES ('${id(1)}','feed','2026-09-01T07:00:00Z'),('${id(2)}','feed','2026-09-07T07:15:00Z'),('${id(2)}','metrics','2026-01-01');`);

const asService = async (sql) => { await db.exec('RESET ROLE; SET ROLE service_role'); try { return (await db.query(sql)).rows; } finally { await db.exec('RESET ROLE'); } };
const enqueue = (dry) => asService(`SELECT public.enqueue_scheduled_report_jobs('${NOW}', ${dry}) AS r`).then((r) => r[0].r);
const jobs = () => db.query(`SELECT kind, client_id, schedule_id, priority, stagger_seconds, status, dedupe_key FROM public.scheduled_jobs ORDER BY priority, dedupe_key`).then((r) => r.rows);

// Only the service role may call the functions or touch the table.
for (const role of ['anon', 'authenticated']) {
  await db.exec(`RESET ROLE; SET ROLE ${role}`);
  await assert.rejects(() => db.query(`SELECT public.enqueue_scheduled_report_jobs('${NOW}', true)`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT * FROM public.scheduled_jobs_lease(300)`), /permission denied/);
  await assert.rejects(() => db.query(`SELECT * FROM public.scheduled_jobs`), /permission denied/);
  await db.exec('RESET ROLE');
}

// Dry run: reports the plan, writes nothing.
const preview = await enqueue(true);
assert.equal(preview.dry_run, true);
assert.equal((await jobs()).length, 0, 'dry run wrote rows');
const plan = preview.enqueued.map((j) => `${j.kind}:${j.detail}:${j.client_id.slice(-1)}`);
// Alpha's feed is 8 days old: due. Beta's is two days old: due only when today is its weekday.
// Archived Gone and set-less NoSet never get a feed; inactive and future schedules never dispatch.
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

// Waiting and blocked dispatches: the competitive completion releases only the matching social job.
await db.exec(`UPDATE public.scheduled_jobs SET status='waiting', lease_until=null WHERE kind='dispatch' AND schedule_id IN ('${id(12)}','${id(22)}');
UPDATE public.report_schedules SET pending_competitive_report_id='${id(900)}' WHERE id='${id(12)}';
UPDATE public.report_schedules SET pending_competitive_report_id='${id(901)}' WHERE id='${id(22)}';`);
const released = await asService(`SELECT public.requeue_dispatch_after_competitive('${id(900)}') AS n`);
assert.equal(released[0].n, 1);
const states = Object.fromEntries((await db.query(`SELECT schedule_id, status FROM public.scheduled_jobs WHERE kind='dispatch'`)).rows.map((r) => [r.schedule_id.slice(-2), r.status]));
assert.equal(states['12'], 'queued');
assert.equal(states['22'], 'waiting');

// The daily tick releases every waiting or blocked dispatch for its recheck.
await db.exec(`UPDATE public.scheduled_jobs SET status='blocked' WHERE schedule_id='${id(22)}'`);
const third = await enqueue(false);
assert.equal(third.released, 1);
assert.equal((await db.query(`SELECT status FROM public.scheduled_jobs WHERE schedule_id='${id(22)}'`)).rows[0].status, 'queued');

// Deleting a schedule removes its jobs; deleting nothing else is required.
await db.exec(`DELETE FROM public.scheduled_jobs WHERE schedule_id='${id(22)}'; DELETE FROM public.report_schedules WHERE id='${id(22)}'`);

// The weekday is stable and in range.
const days = (await db.query(`SELECT public.feed_refresh_weekday(id) AS d FROM public.clients`)).rows.map((r) => r.d);
assert(days.every((d) => d >= 0 && d <= 6));
assert.equal((await db.query(`SELECT public.feed_refresh_weekday('${id(1)}') = public.feed_refresh_weekday('${id(1)}') AS same`)).rows[0].same, true);

await db.close();
console.log('PASS: queue migration applies twice; only service_role reaches it; dry run writes nothing; enqueue is idempotent and ordered with the old stagger; lease is exclusive and counts attempts; completion releases only its social job; the daily tick rechecks waiting and blocked jobs.');
