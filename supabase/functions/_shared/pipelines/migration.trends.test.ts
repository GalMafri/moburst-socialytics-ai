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


const themesRead = code("20261102100000_trend_access.sql");

describe("20261102100000_trend_access.sql", () => {
  it("answers only people who may reach the client asked about, so company-scoped staff see their own companies only", () => {
    expect(themesRead).toContain("if not public.can_access_client(p_client) then raise exception 'Not allowed.' using errcode = '42501'; end if;");
    // Staff alone is not the gate (a company-scoped staff member is staff); it only decides who sees the weighted engagement.
    expect(themesRead).not.toContain("if not (v_staff or");
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

  it("lets staff read each trend table directly, for their own companies only, and takes client users' direct reads away", () => {
    const policies: Array<[string, string]> = [
      ["Staff read trend profiles", "trend_profiles"],
      ["Staff read trend terms", "trend_terms"],
      ["Staff read trend weeks", "trend_weeks"],
      ["Read kept trend posts", "trend_posts"],
      ["Read trend themes", "trend_themes"],
    ];
    for (const [name, table] of policies) {
      expect(themesRead).toContain(`drop policy if exists "${name}" on public.${table};`);
      expect(themesRead).toContain(`create policy "${name}" on public.${table} for select to authenticated using (public.is_moburst_staff() and public.can_access_client(client_id));`);
    }
    // No policy lets a client member read a trend table; the function above is their way in.
    expect(themesRead).not.toContain("is_client_member(client_id)");
  });

  describe("the three staff functions", () => {
    const body = (name: string) => {
      const start = themesRead.indexOf(`create or replace function public.${name}(`);
      expect(start).toBeGreaterThanOrEqual(0);
      return themesRead.slice(start, themesRead.indexOf("end $$;", start) + "end $$;".length);
    };

    it("trend_term_add needs staff and access to the client it adds to", () => {
      const add = body("trend_term_add");
      expect(add).toContain("if not (public.is_moburst_staff() and public.can_access_client(p_client)) then raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501'; end if;");
      // Unchanged: the term is normalized and a person's add brings a removed term back as theirs.
      expect(add).toContain("on conflict (client_id, kind, coalesce(platform, ''), lower(term)) do update set source = 'person', removed_at = null, removed_by = null");
    });

    it("trend_term_add makes a hashtag one tag: one leading #, no whitespace inside, and a tag with nothing left is refused", () => {
      const add = body("trend_term_add");
      expect(add).toContain("if p_kind = 'hashtag' then v_term := '#' || ltrim(regexp_replace(v_term, '\\s', '', 'g'), '#'); if v_term = '#' then raise exception 'A term is required.' using errcode = '22023'; end if; end if;");
      // Whitespace goes before the leading #s do, so "# #" is a bare # and refused, not "##".
      // The staff check still comes first, and the old "add a # when there is none" branch is gone.
      expect(add.indexOf("can_access_client(p_client)")).toBeLessThan(add.indexOf("regexp_replace"));
      expect(add).not.toContain("left(v_term, 1) <> '#'");
      // Topics and exclusions are not touched: the branch is for hashtags only.
      expect(add).toContain("if p_kind <> 'hashtag' then v_platform := null; end if;");
    });

    it("trend_term_remove needs staff and access to the term's client; a missing term does nothing", () => {
      const remove = body("trend_term_remove");
      expect(remove).toContain("if not public.is_moburst_staff() then raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501'; end if;");
      expect(remove).toContain("select client_id into v_client from public.trend_terms where id = p_id; if v_client is null then return; end if;");
      expect(remove).toContain("if not public.can_access_client(v_client) then raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501'; end if;");
      // The scope check comes before the change.
      expect(remove.indexOf("can_access_client(v_client)")).toBeLessThan(remove.indexOf("update public.trend_terms"));
      expect(remove).toContain("update public.trend_terms set removed_at = now(), removed_by = auth.uid() where id = p_id and removed_at is null;");
    });

    it("trend_theme_dismiss needs staff and access to the theme's client; a missing theme does nothing", () => {
      const dismiss = body("trend_theme_dismiss");
      expect(dismiss).toContain("if not public.is_moburst_staff() then raise exception 'Only Moburst staff can dismiss a trend.' using errcode = '42501'; end if;");
      expect(dismiss).toContain("select client_id into v_client from public.trend_themes where id = p_theme; if v_client is null then return; end if;");
      expect(dismiss).toContain("if not public.can_access_client(v_client) then raise exception 'Only Moburst staff can dismiss a trend.' using errcode = '42501'; end if;");
      expect(dismiss.indexOf("can_access_client(v_client)")).toBeLessThan(dismiss.indexOf("update public.trend_themes"));
      // Unchanged: the dismissed theme's pattern becomes an exclusion the next weekly filter reads.
      expect(dismiss).toContain("insert into public.trend_terms (client_id, kind, platform, term, reason, source) values (v_theme.client_id, 'exclusion', null, v_theme.title, v_theme.happening, 'dismissal')");
    });

    it("all three run as their owner on a fixed search path, for signed-in users only", () => {
      for (const name of ["trend_term_add", "trend_term_remove", "trend_theme_dismiss"]) expect(body(name)).toContain("language plpgsql security definer set search_path = public");
      expect(themesRead).toContain("revoke all on function public.trend_term_add(uuid, text, text, text) from public, anon");
      expect(themesRead).toContain("revoke all on function public.trend_term_remove(uuid) from public, anon");
      expect(themesRead).toContain("revoke all on function public.trend_theme_dismiss(uuid) from public, anon");
      expect(themesRead).toContain("grant execute on function public.trend_term_add(uuid, text, text, text) to authenticated");
      expect(themesRead).toContain("grant execute on function public.trend_term_remove(uuid) to authenticated");
      expect(themesRead).toContain("grant execute on function public.trend_theme_dismiss(uuid) to authenticated");
    });
  });
});

const measures = code("20261108100000_trend_measures.sql");

describe("20261108100000_trend_measures.sql", () => {
  it("answers staff only, and only for the clients each may reach", () => {
    expect(measures).toContain("if not public.is_moburst_staff() then raise exception 'Not allowed.' using errcode = '42501'; end if;");
    expect(measures).toContain("if p_client is not null and not public.can_access_client(p_client) then raise exception 'Not allowed.' using errcode = '42501'; end if;");
    // With no client named, a company-scoped staff member gets their own companies' weeks only.
    expect(measures).toContain("where (p_client is null or w.client_id = p_client) and public.can_access_client(w.client_id)");
    // Both checks come before anything is read.
    expect(measures.indexOf("can_access_client(p_client)")).toBeLessThan(measures.indexOf("return query"));
  });

  it("runs as its owner on a fixed search path, for signed-in users only", () => {
    expect(measures).toContain("create or replace function public.trend_measures(p_client uuid default null)");
    expect(measures).toContain("language plpgsql stable security definer set search_path = public");
    expect(measures).toContain("revoke all on function public.trend_measures(uuid) from public, anon");
    expect(measures).toContain("grant execute on function public.trend_measures(uuid) to authenticated");
  });

  it("names its output columns apart from every column its statements use", () => {
    // A PL/pgSQL output column is also a variable, and one named like a column fails as ambiguous on a real run.
    const out = measures.match(/returns table \(([^)]*)\)/)![1].split(",").map((c) => c.trim().split(" ")[0]);
    expect(out).toEqual(["client", "client_name", "week", "run_status", "kept_per_platform", "tripwire_hits", "dismissed", "terms_removed", "used_share", "week_cost"]);
    for (const column of ["id", "client_id", "week_id", "week_start", "status", "platforms", "kept", "tripwire", "dismissed_at", "kind", "removed_at", "post_date", "reasons", "cost", "name"]) expect(out).not.toContain(column);
  });

  it("counts each week's kept posts per watched platform, tripwire hits among them, and dismissed themes", () => {
    expect(measures).toContain("select jsonb_object_agg(e.key, coalesce((e.value->>'kept')::int, 0)) from jsonb_each(w.platforms) e where e.value->>'status' is distinct from 'not_watched'");
    expect(measures).toContain("select count(*)::int from public.trend_posts p where p.week_id = w.id and p.kept and p.tripwire");
    expect(measures).toContain("select count(*)::int from public.trend_themes th where th.week_id = w.id and th.dismissed_at is not null");
  });

  it("counts the topics and hashtags a person removed during the week, Monday to Monday in Israel time", () => {
    expect(measures).toContain("t.client_id = w.client_id and t.kind in ('topic', 'hashtag') and t.removed_at >= (w.week_start::timestamp at time zone 'Asia/Jerusalem') and t.removed_at < ((w.week_start + 7)::timestamp at time zone 'Asia/Jerusalem')");
  });

  it("gives the share of the week's calendar posts whose first reason is a trend, and none for a week with no posts", () => {
    expect(measures).toContain("round(count(*) filter (where cp.reasons->0->>'type' = 'trend')::numeric / nullif(count(*), 0), 3)");
    expect(measures).toContain("cp.client_id = w.client_id and cp.post_date between w.week_start and w.week_start + 6");
  });

  it("returns every week with its cost and run status, newest first per client", () => {
    expect(measures).toContain("w.cost from public.trend_weeks w join public.clients c on c.id = w.client_id");
    expect(measures).toContain("w.week_start, w.status,");
    expect(measures).toContain("order by c.name, w.client_id, w.week_start desc");
  });
});

// Read lazily: a missing file fails these tests only, not the ones above.
const readsFix = () => code("20261108110000_trend_reads_fix.sql");
const fnIn = (sql: string, name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("end $$;", start) + "end $$;".length);
};

describe("20261108110000_trend_reads_fix.sql", () => {
  describe("trend_themes_in_range", () => {
    it("leaves out kept posts the tripwire flagged, for everyone", () => {
      const read = fnIn(readsFix(), "trend_themes_in_range");
      expect(read).toContain("where p.id = any (th.post_ids) and p.kept and not p.tripwire and p.client_id = p_client");
      // Not tied to who is asking: staff do not get them either.
      expect(read).not.toMatch(/case when v_staff[^)]*tripwire/);
      // The flag itself never leaves the function.
      expect(read).not.toContain("'tripwire'");
    });

    it("counts a week when any of its seven days falls in the window", () => {
      const read = fnIn(readsFix(), "trend_themes_in_range");
      expect(read).toContain("and w.week_start <= p_to and w.week_start + 6 >= p_from");
      // A week that starts before the window and ends inside it is no longer left out.
      expect(read).not.toContain("between p_from and p_to");
    });

    it("keeps everything else as 20261102100000_trend_access.sql has it, grants included", () => {
      const before = fnIn(themesRead, "trend_themes_in_range");
      expect(fnIn(readsFix(), "trend_themes_in_range")).toBe(before
        .replace("p.kept and p.client_id = p_client", "p.kept and not p.tripwire and p.client_id = p_client")
        .replace("and w.week_start between p_from and p_to", "and w.week_start <= p_to and w.week_start + 6 >= p_from"));
      expect(readsFix()).toContain("revoke all on function public.trend_themes_in_range(uuid, date, date) from public, anon");
      expect(readsFix()).toContain("grant execute on function public.trend_themes_in_range(uuid, date, date) to authenticated");
    });
  });

  describe("trend_term_add", () => {
    it("makes a hashtag # and letters, digits or underscores only, and refuses one with nothing left", () => {
      const add = fnIn(readsFix(), "trend_term_add");
      expect(add).toContain("if p_kind = 'hashtag' then v_term := '#' || regexp_replace(v_term, '[^[:alnum:]_]', '', 'g'); if v_term = '#' then raise exception 'A term is required.' using errcode = '22023'; end if; end if;");
      // The older whitespace-only rule is gone: punctuation inside a tag is taken out too.
      expect(add).not.toContain("ltrim(regexp_replace(v_term, '\\s', '', 'g'), '#')");
    });

    it("keeps everything else as 20261102100000_trend_access.sql has it, grants included", () => {
      const before = fnIn(themesRead, "trend_term_add");
      expect(fnIn(readsFix(), "trend_term_add")).toBe(before.replace(
        "v_term := '#' || ltrim(regexp_replace(v_term, '\\s', '', 'g'), '#');",
        "v_term := '#' || regexp_replace(v_term, '[^[:alnum:]_]', '', 'g');",
      ));
      expect(readsFix()).toContain("revoke all on function public.trend_term_add(uuid, text, text, text) from public, anon");
      expect(readsFix()).toContain("grant execute on function public.trend_term_add(uuid, text, text, text) to authenticated");
    });
  });

  describe("trend_search_override_clear", () => {
    it("lets staff who may reach the client clear one platform's rewritten searches, in one update of that key only", () => {
      const clear = fnIn(readsFix(), "trend_search_override_clear");
      expect(clear).toContain("create or replace function public.trend_search_override_clear(p_client uuid, p_platform text) returns void language plpgsql security definer set search_path = public as $$");
      expect(clear).toContain("if not (public.is_moburst_staff() and public.can_access_client(p_client)) then raise exception 'Only Moburst staff can change what trends track.' using errcode = '42501'; end if;");
      // Only that platform's key goes; the other platforms' rewrites stay. A platform with none (or no platform) changes nothing.
      expect(clear).toContain("update public.trend_profiles set search_overrides = search_overrides - p_platform where client_id = p_client and search_overrides ? p_platform;");
      expect(clear.match(/\bupdate\b/g)).toHaveLength(1);
      expect(clear).not.toMatch(/\b(insert|delete)\b/);
      // The check comes before the change.
      expect(clear.indexOf("can_access_client(p_client)")).toBeLessThan(clear.indexOf("update public.trend_profiles"));
    });

    it("runs for signed-in users only", () => {
      expect(readsFix()).toContain("revoke all on function public.trend_search_override_clear(uuid, text) from public, anon");
      expect(readsFix()).toContain("grant execute on function public.trend_search_override_clear(uuid, text) to authenticated");
    });
  });
});
