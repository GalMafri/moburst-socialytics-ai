import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite} = await import(process.env.QA_SQL_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
await db.exec(`CREATE ROLE authenticated;
CREATE FUNCTION can_access_client(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('qa.role') IN ('admin','staff') OR id::text=current_setting('qa.client') $$;
CREATE FUNCTION can_write_client(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('qa.role') != 'client' AND can_access_client(id) $$;
SELECT set_config('qa.role','admin',false),set_config('qa.client','${a}',false);`);
for (const table of ['clients','reports','post_iterations','sprout_profiles']) {
  await db.exec(`CREATE TABLE ${table}(id uuid PRIMARY KEY,client_id uuid,content text);
  INSERT INTO ${table} VALUES('${a}','${a}','first'),('${b}','${b}','second');
  ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
  GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO authenticated;
  CREATE POLICY "Legacy broad grant" ON ${table} FOR ALL TO authenticated USING (true) WITH CHECK (true);`);
}
const migration=readFileSync(new URL('../supabase/migrations/20260929120000_enforce_client_scope_guards.sql',import.meta.url),'utf8');
await db.exec(migration); await db.exec(migration);
await db.exec('SET ROLE authenticated');
let checks=0;
for (const table of ['clients','reports','post_iterations','sprout_profiles']) {
  for (const role of ['admin','staff','restricted','client']) {
    await db.query(`SELECT set_config('qa.role',$1,false)`,[role]);
    const rows=(await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows;
    assert.equal(rows.length,['admin','staff'].includes(role)?2:1); checks++;
    if (['restricted','client'].includes(role)) {
      const changed=await db.query(`UPDATE ${table} SET content='forbidden' WHERE id='${b}' RETURNING id`);
      assert.equal(changed.rows.length,0); checks++;
      const deleted=await db.query(`DELETE FROM ${table} WHERE id='${b}' RETURNING id`);
      assert.equal(deleted.rows.length,0); checks++;
      if(table!=='clients') {
        await assert.rejects(()=>db.query(`INSERT INTO ${table} VALUES ('00000000-0000-0000-0000-000000000003','${b}','forbidden')`),/row-level security/); checks++;
      }
      if(role==='client') {await assert.rejects(()=>db.query(`UPDATE ${table} SET content='forbidden' WHERE id='${a}'`),/row-level security/);checks++;}
      else {assert.equal((await db.query(`UPDATE ${table} SET content='allowed' WHERE id='${a}' RETURNING id`)).rows.length,1);checks++;}
    }
  }
}
await db.close();
console.log(`PASS ${checks} RLS checks: existing permissive grants cannot bypass scope; admin/staff access retained; restricted staff write only their client; client writes denied. Migration is idempotent.`);
