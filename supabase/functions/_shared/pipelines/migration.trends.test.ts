// @vitest-environment node
// The Trends migrations, read as text (their behavior on Postgres is checked
// when Task 8 applies them). Guards the mistakes a dry run would not show.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const code = (name: string) => readFileSync(join(migrations, name), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const job = code("20261029100100_trend_refresh_job.sql");

describe("20261029100100_trend_refresh_job.sql", () => {
  it("names the enqueue function's output columns apart from every column its statements use", () => {
    // A PL/pgSQL output column is also a variable: one named like a column the
    // insert's on conflict target uses fails as ambiguous on every real run
    // (checked on Postgres 1 Nov 2026), while a dry run never reaches the insert.
    const out = job.match(/returns table \(([^)]*)\)/)![1].split(",").map((c) => c.trim().split(" ")[0]);
    for (const column of ["client_id", "dedupe_key", "kind", "priority", "available_at", "status", "week_start", "id"]) expect(out).not.toContain(column);
  });

  it("queues a week again whose run stopped, at most three stopped runs a week, and closes a week that used them up", () => {
    expect(job).toMatch(/r\.status = 'running'/);
    // Only stopped runs count: a replay or a finished run never uses up a week's tries.
    expect(job).toContain("(select count(*) from public.report_pipeline_runs r where r.real_id = w.id and r.status = 'stopped') < 3");
    expect(job).toContain("(select count(*) from public.report_pipeline_runs r where r.real_id = trend_weeks.id and r.status = 'stopped') >= 3");
    expect(job).toMatch(/update public\.trend_weeks set status = 'partial'/);
  });
});

const hardening = code("20261101120000_trends_hardening.sql");

describe("20261101120000_trends_hardening.sql", () => {
  it("queues Trends steps after real report runs (25) and their shadows (60)", () => {
    expect(hardening).toContain("case when p_kind = 'trends' then 80 when p_mode = 'app' then 25 else 60 end");
  });

  it("refuses every write to the trend tables from client and anonymous users", () => {
    expect(hardening).toContain("revoke insert, update, delete, truncate on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon, authenticated");
    expect(hardening).toContain("revoke all on public.trend_profiles, public.trend_terms, public.trend_weeks, public.trend_posts, public.trend_themes from anon");
  });

  it("hides dismissed themes from client users", () => {
    expect(hardening).toContain("using (public.is_moburst_staff() or (dismissed_at is null and public.is_client_member(client_id)))");
  });
});


const themesRead = code("20261102100000_trend_themes_read.sql");

describe("20261102100000_trend_themes_read.sql", () => {
  it("answers only Moburst staff and members of the client asked about", () => {
    expect(themesRead).toContain("if not (v_staff or public.is_client_member(p_client)) then raise exception 'Not allowed.' using errcode = '42501'; end if;");
    expect(themesRead).toContain("v_staff boolean := public.is_moburst_staff();");
    // The function reads tables a client cannot, so it asks for one client's rows and nothing else.
    expect(themesRead).toContain("th.client_id = p_client");
    expect(themesRead).toContain("w.client_id = p_client");
    expect(themesRead).toContain("p.client_id = p_client");
  });

  it("leaves out dismissed themes (for staff too) and weeks that did not finish", () => {
    expect(themesRead).toContain("th.dismissed_at is null");
    expect(themesRead).toContain("w.status in ('done', 'partial')");
    expect(themesRead).toContain("w.week_start between p_from and p_to");
  });

  it("says whether the client has any finished week at all, on any date, apart from the themes in the range", () => {
    expect(themesRead).toContain("return jsonb_build_object( 'collected', exists ( select 1 from public.trend_weeks c where c.client_id = p_client and c.status in ('done', 'partial') ), 'themes', coalesce((");
    // The flag does not depend on the range or on dismissals: no date, no theme table in it.
    const flag = themesRead.slice(themesRead.indexOf("'collected', exists ("), themesRead.indexOf("'themes', coalesce(("));
    expect(flag).not.toContain("p_from");
    expect(flag).not.toContain("p_to");
    expect(flag).not.toContain("trend_themes");
    expect(themesRead).toContain("), '[]'::jsonb) ); end $$;");
  });

  it("returns newest week first, then by position, each theme with only the kept posts it lists", () => {
    expect(themesRead).toContain("order by t.week_start desc, t.position");
    expect(themesRead).toContain("p.id = any (th.post_ids) and p.kept");
    // The theme's own order of posts (best first) is kept.
    expect(themesRead).toContain("order by array_position(th.post_ids, p.id)");
  });

  it("gives the weighted engagement to staff only", () => {
    expect(themesRead).toContain("'engagement', case when v_staff then p.engagement end");
    // Nothing internal about a post leaves the function: no fit, reason, lesson, tripwire or search.
    for (const internal of ["p.fit", "p.why", "p.lesson", "p.tripwire", "p.drop_reason", "p.search"]) expect(themesRead).not.toContain(internal);
  });

  it("runs as its owner on a fixed search path, for signed-in users only", () => {
    expect(themesRead).toContain("language plpgsql stable security definer set search_path = public");
    expect(themesRead).toContain("revoke all on function public.trend_themes_in_range(uuid, date, date) from public, anon");
    expect(themesRead).toContain("grant execute on function public.trend_themes_in_range(uuid, date, date) to authenticated");
  });

  it("takes direct reads of trend posts and themes away from client users, keeping the staff's", () => {
    expect(themesRead).toContain('create policy "Read kept trend posts" on public.trend_posts for select to authenticated using (public.is_moburst_staff())');
    expect(themesRead).toContain('create policy "Read trend themes" on public.trend_themes for select to authenticated using (public.is_moburst_staff())');
    expect(themesRead).not.toContain("is_client_member(client_id)");
  });
});
