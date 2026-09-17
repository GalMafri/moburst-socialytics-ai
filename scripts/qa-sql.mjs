const { PGlite } = await import(process.env.QA_SQL_MODULE || '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.competitive_reports(id uuid PRIMARY KEY);
CREATE TABLE public.post_iterations(id uuid PRIMARY KEY);
CREATE TABLE public.report_schedules(id uuid PRIMARY KEY, is_active boolean, next_run_at timestamptz);
INSERT INTO public.report_schedules VALUES ('00000000-0000-0000-0000-000000000001',true,'2020-01-01');`);
for (const file of ['20260917170000_calendar_copy_identity.sql','20260917171000_schedule_dependencies.sql']) {
 const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
}
assert.equal((await db.query(`SELECT calendar_post_key FROM public.post_iterations`)).rows.length,0);
const q=`SELECT public.claim_report_schedule('00000000-0000-0000-0000-000000000001','2020-01-01') as claimed`;
await db.exec('SET ROLE authenticated');
await assert.rejects(()=>db.query(q),/permission denied/);
await db.exec('RESET ROLE; SET ROLE anon');
await assert.rejects(()=>db.query(q),/permission denied/);
await db.exec('RESET ROLE; SET ROLE service_role');
assert.equal((await db.query(q)).rows[0].claimed,true);
assert.equal((await db.query(q)).rows[0].claimed,false);
assert.equal((await db.query(q.replace('2020-01-01','2020-01-02'))).rows[0].claimed,false);
await db.exec(`RESET ROLE; UPDATE public.report_schedules SET dispatch_claimed_at=null,is_active=false; SET ROLE service_role;`);
assert.equal((await db.query(q)).rows[0].claimed,false);
await db.exec(`RESET ROLE; UPDATE public.report_schedules SET is_active=true,next_run_at='2099-01-01'; SET ROLE service_role;`);
assert.equal((await db.query(q.replace('2020-01-01','2099-01-01'))).rows[0].claimed,false);
await db.close();
console.log('PASS: both migrations apply twice; client/anonymous claim denied; service role claims once; wrong cycle, inactive and future schedules denied.');
