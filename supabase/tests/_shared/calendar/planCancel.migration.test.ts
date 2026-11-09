// @vitest-environment node
// Stopping a week's plan (Lital, 3 Nov 2026), the database half, read as
// text (the coordinator applies it by hand): additive and safe to run twice,
// one function a person's request reaches, guarded as the Claude connector
// asks, and a plan that was stopped takes no posts. scripts/qa-sql-plan-cancel.mjs
// runs the same file against Postgres (PGlite).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const FILE = "20261110100000_calendar_plan_cancel.sql";
const sql = readFileSync(join(root, "supabase", "migrations", FILE), "utf8").replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const types = readFileSync(join(root, "src", "integrations", "supabase", "types.ts"), "utf8");
const body = (name: string) => {
  const m = new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, "i").exec(sql);
  if (!m) throw new Error(`${name} is not defined in ${FILE}`);
  return m[1];
};

describe(FILE, () => {
  it("adds and never drops: a status, who stopped it and when, and the archive's Story link", () => {
    expect(sql).not.toMatch(/drop (table|column|function|view)|truncate/i);
    expect(sql).toContain("alter table public.calendar_plans drop constraint if exists calendar_plans_status_check;");
    expect(sql).toContain("check (status in ('queued', 'planning', 'ready', 'failed', 'expired', 'canceled'))");
    expect(sql).toContain("alter table public.calendar_plans add column if not exists canceled_at timestamptz;");
    expect(sql).toContain("alter table public.calendar_plans add column if not exists canceled_by uuid;");
    expect(sql).toContain("alter table public.calendar_posts_archive add column if not exists story_of text;");
    // Run twice, the trigger is made again rather than added twice.
    expect(sql).toContain("drop trigger if exists calendar_posts_plan_open on public.calendar_posts;");
  });

  describe("calendar_stop_plan", () => {
    const stop = body("calendar_stop_plan");

    it("refuses a connected app before anything else, and only the service role can call it", () => {
      expect(stop.trimStart()).toMatch(/^declare[\s\S]*?begin if public\.is_oauth_session\(\) then raise exception 'Connected apps can read Socialytics but cannot change it\.' using errcode = '42501'; end if;/);
      expect(sql).toContain("revoke all on function public.calendar_stop_plan(uuid, uuid) from public, anon, authenticated;");
      expect(sql).toContain("grant execute on function public.calendar_stop_plan(uuid, uuid) to service_role;");
    });

    it("holds the plan while it works, and answers a second press with the plan as it is", () => {
      expect(stop).toContain("select * into v_plan from calendar_plans where id = p_plan for update;");
      expect(stop).toMatch(/if v_plan\.status = 'canceled' then return v_plan; end if;/);
    });

    it("stops a plan on its way, or removes a finished one while its week has days to come, and nothing else", () => {
      expect(stop).toContain("elsif v_plan.status not in ('queued', 'planning') then");
      expect(stop).toContain("if v_plan.week_start + 6 < v_today then");
    });

    it("closes the week's plan and revision jobs, so no run starts after the press", () => {
      expect(stop).toMatch(/update scheduled_jobs set status = 'skipped'[^;]*where kind in \('week_plan', 'week_revise'\) and client_id = v_plan\.client_id and occurrence = v_plan\.week_start::timestamptz and status in \('queued', 'running', 'waiting', 'blocked'\);/);
    });

    it("takes off only the posts nobody worked on, keeps them in the archive, and leaves the rest where they are", () => {
      expect(stop).toMatch(/delete from calendar_posts cp where cp\.plan_id = v_plan\.id and not calendar_post_worked\(cp\.client_id, cp\.post_key, cp\.platform, cp\.copy, cp\.touched_at\) returning cp\.\*/);
      expect(stop).toMatch(/insert into calendar_posts_archive select \(jsonb_populate_record\(null::calendar_posts_archive,/);
      expect(stop).toContain("update calendar_posts set plan_id = null where plan_id = v_plan.id;");
      expect(stop).toMatch(/set status = 'canceled', claimed_at = null, pending_revision = null/);
      expect(stop).toContain("canceled_at = now(), canceled_by = p_user");
    });
  });

  it("lets no post into a plan that was stopped, even from a run between its check and its write", () => {
    const open = body("calendar_posts_plan_open");
    expect(open).toContain("perform 1 from calendar_plans where id = new.plan_id and status <> 'canceled' for share;");
    expect(open).toMatch(/if not found then raise exception/);
    expect(sql).toContain("create trigger calendar_posts_plan_open before insert on public.calendar_posts for each row execute function public.calendar_posts_plan_open();");
  });

  it("plans a stopped week again only when a person asks, never on an automatic run", () => {
    const request = body("calendar_request_week");
    expect(request).toContain("or (p.status = 'canceled' and p_trigger = 'button')");
    expect(request).toContain("canceled_at = null, canceled_by = null");
    expect(sql).toContain("revoke all on function public.calendar_request_week(uuid, date, text, uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function public.calendar_request_week(uuid, date, text, uuid) to service_role;");
  });

  it("is in the generated types, written by hand in their format", () => {
    const plans = types.slice(types.indexOf("      calendar_plans: {"), types.indexOf("      calendar_posts: {"));
    expect(plans.match(/canceled_at\??: string \| null/g)).toHaveLength(3);
    expect(plans.match(/canceled_by\??: string \| null/g)).toHaveLength(3);
    const archive = types.slice(types.indexOf("      calendar_posts_archive: {"), types.indexOf("Relationships", types.indexOf("      calendar_posts_archive: {")));
    expect(archive.match(/story_of\??: string \| null/g)).toHaveLength(3);
    expect(types).toMatch(/calendar_stop_plan: \{\s+Args: \{ p_plan: string; p_user\?: string \}\s+Returns: \{[\s\S]*?canceled_at: string \| null/);
  });
});
