import { useMemo, useState } from "react";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { Loading } from "@/components/ui/loading";
import { LoadError } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users, Zap, AlertCircle, MoonStar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FunnelCard,
  MetricsCard,
  FeatureTable,
  type MetricRow,
  type FunnelRow,
  type FeatureRow,
} from "@/components/usage/UsageSections";
import { UserDetail } from "@/components/usage/UserDetail";
import { formatDate, roleName, usageStateName } from "@/lib/display";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Admin-only view of who actually uses Socialytics.
 *
 * Every count of actions and of actions that did not finish comes from one
 * database function, usage_actions() (migration 20261019210000): the tiles
 * and the chart read get_usage_trend(), the Features tab reads
 * get_feature_adoption(), and the per-person table reads user_analytics, and
 * all three are built on it.
 *
 * Reads through get_user_analytics() / get_usage_trend() rather than the
 * underlying views. Both functions are SECURITY DEFINER and gate on
 * is_admin(), so anyone below admin gets an empty set instead of everyone
 * else's usage. The views themselves stay revoked from the app roles, and
 * the route is wrapped in AdminOnlyRoute — the DB gate is the real boundary,
 * the route just avoids showing a dead page.
 *
 * Caveat worth keeping in mind when reading these numbers: rows written before
 * Aug 2026 mostly have no created_by, so historical per-user counts understate
 * reality. Client-level totals were always complete.
 */

const WINDOW_DAYS = 90;

type UserRow = {
  email: string;
  name: string | null;
  company: string | null;
  role: string | null;
  provisioned_at: string | null;
  last_sign_in_at: string | null;
  first_action_at: string | null;
  last_action_at: string | null;
  actions_total: number;
  reports_ok: number;
  posts_created: number;
  posts_iterated: number;
  posts_approved: number;
  clients_touched: number;
  active_days: number;
  failures: number;
  state: string;
};

type TrendRow = { day: string; actions: number; active_users: number; failures: number };

const STATE_STYLE: Record<string, string> = {
  habit: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  active: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  lapsed: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "logged in, no output": "bg-rose-500/15 text-rose-400 border-rose-500/30",
  "never logged in": "bg-muted text-muted-foreground border-border",
};

const fmtDate = (v: string | null) => formatDate(v);

function Tile({ label, value, hint, icon: Icon, tone }: { label: string; value: number | string; hint?: string; icon: typeof Users; tone?: "warn" }) {
  return (
    <StatCard
      label={label}
      icon={<Icon className="h-3.5 w-3.5" />}
      value={tone === "warn" ? <span className="!text-[#f87171]">{value}</span> : value}
      sub={hint}
    />
  );
}

export default function Usage() {
  const [selected, setSelected] = useState<{ email: string; name: string | null } | null>(null);
  const users = useQuery({
    queryKey: ["usage", "users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_analytics");
      if (error) throw error;
      return (data ?? []) as unknown as UserRow[];
    },
  });

  const trend = useQuery({
    queryKey: ["usage", "trend"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_usage_trend");
      if (error) throw error;
      return (data ?? []) as unknown as TrendRow[];
    },
  });


  // Behavioural layer. These come from app_events, so they only cover the
  // period since action tracking shipped — unlike the per-user counts above,
  // which are derived from work records going back to the first run.
  const metricQuery = (key: string, fn: "get_funnel" | "get_ai_quality" | "get_report_engagement" | "get_session_quality" | "get_feature_adoption") =>
    ({
      queryKey: ["usage", key, WINDOW_DAYS],
      queryFn: async () => {
        const { data, error } = await supabase.rpc(fn, { days: WINDOW_DAYS });
        if (error) throw error;
        return (data ?? []) as unknown as unknown[];
      },
    });

  const funnel = useQuery(metricQuery("funnel", "get_funnel"));
  const ai = useQuery(metricQuery("ai", "get_ai_quality"));
  const reading = useQuery(metricQuery("reading", "get_report_engagement"));
  const sessions = useQuery(metricQuery("sessions", "get_session_quality"));
  const features = useQuery(metricQuery("features", "get_feature_adoption"));

  const rows = useMemo(
    () => [...(users.data ?? [])].sort((a, b) => b.actions_total - a.actions_total),
    [users.data],
  );

  // Actions and the ones that did not finish, from the same rows the chart draws.
  const activity = useMemo(() => {
    const rows = trend.data ?? [];
    return { actions: rows.reduce((n, d) => n + Number(d.actions || 0), 0), failures: rows.reduce((n, d) => n + Number(d.failures || 0), 0) };
  }, [trend.data]);

  const summary = useMemo(() => {
    const r = users.data ?? [];
    const byState = r.reduce<Record<string, number>>((acc, u) => {
      acc[u.state] = (acc[u.state] ?? 0) + 1;
      return acc;
    }, {});
    return {
      total: r.length,
      producing: r.filter((u) => u.actions_total > 0).length,
      idle: (byState["logged in, no output"] ?? 0) + (byState["never logged in"] ?? 0),
      habit: byState["habit"] ?? 0,
      byState,
    };
  }, [users.data]);

  if (users.isLoading) {
    return (
      <AppLayout title="User analytics" description="Who uses Socialytics and how: per person, over time, by behavior and by feature.">
        <Loading variant="page" label="Loading usage" />
      </AppLayout>
    );
  }

  // A caller with no Supabase session is `anon`, which has no execute grant on
  // the reporting functions, so PostgREST returns 42501. That is not a fault to
  // report as one: it means the person is not signed in. It happens on the
  // branded URL before the portal handoff, and in local dev where useAuth shows
  // a placeholder user without ever creating a Supabase session.
  const notSignedIn =
    users.error != null &&
    /permission denied|42501|JWT|not authenticated/i.test(String((users.error as Error).message));

  if (notSignedIn) {
    return (
      <AppLayout title="User analytics" description="Who uses Socialytics and how: per person, over time, by behavior and by feature.">
        <EmptyState
          icon={Users}
          title="Sign in to view usage"
          description="Open this tool from the Moburst portal so it can sign you in, then come back to this page. If you opened it directly, that sign-in has not happened yet."
        />
      </AppLayout>
    );
  }

  if (users.error) {
    return (
      <AppLayout title="User analytics" description="Who uses Socialytics and how: per person, over time, by behavior and by feature.">
        <LoadError title="Usage did not load" onRetry={() => void users.refetch()} />
      </AppLayout>
    );
  }

  if (rows.length === 0) {
    return (
      <AppLayout title="User analytics" description="Who uses Socialytics and how: per person, over time, by behavior and by feature.">
        <EmptyState icon={Users} title="No usage to show" description="This page is limited to admin accounts." />
      </AppLayout>
    );
  }

  const idlePct = summary.total ? Math.round((summary.idle / summary.total) * 100) : 0;

  return (
    <AppLayout title="User analytics" description="Who uses Socialytics and how: per person, over time, by behavior and by feature, with each person's full history.">
        <StatGrid>
          <Tile label="Provisioned" value={summary.total} hint={`${summary.producing} have done work in the product`} icon={Users} />
          <Tile label="Regular users" value={summary.habit} hint="3 or more finished reports" icon={Zap} />
          <Tile
            label="Idle seats"
            value={summary.idle}
            hint={`${idlePct}% of everyone provisioned`}
            icon={MoonStar}
            tone={summary.idle > summary.producing ? "warn" : undefined}
          />
          {/* Internal health, admins only: the same rows as the activity chart. */}
          <Tile label="Did not finish" value={activity.failures} hint={`of ${activity.actions} actions, all time`} icon={AlertCircle} />
        </StatGrid>

        <Tabs defaultValue="people" className="space-y-section">
          <TabsList>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="behaviour">Behavior</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-section">
          <div className="grid gap-section lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="t-h3">Activity over time</CardTitle>
              </CardHeader>
              <CardContent>
                {trend.data && trend.data.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend.data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                        <defs>
                          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                        <XAxis
                          dataKey="day"
                          tickFormatter={(d) => fmtDate(d)}
                          tick={{ fontSize: 11 }}
                          stroke="hsl(var(--muted-foreground))"
                          minTickGap={24}
                        />
                        <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                        <Tooltip
                          labelFormatter={(d) => fmtDate(String(d))}
                          contentStyle={{
                            backgroundColor: "rgba(26, 29, 35, 0.95)",
                            borderColor: "rgba(255, 255, 255, 0.08)",
                            borderRadius: "12px",
                            backdropFilter: "blur(16px)",
                            color: "#fff",
                            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                            fontSize: 13,
                          }}
                          cursor={{ stroke: "rgba(255, 255, 255, 0.12)" }}
                        />
                        <Area
                          type="monotone"
                          dataKey="actions"
                          name="Actions"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          fill="url(#usageFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState framed={false} icon={Users} title="No activity recorded yet" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="t-h3">Where people stand</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(summary.byState)
                  .sort((a, b) => b[1] - a[1])
                  .map(([state, n]) => (
                    <div key={state}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="t-body">{usageStateName(state)}</span>
                        <span className="t-body font-medium tabular-nums">{n}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${summary.total ? (n / summary.total) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </div>
          </TabsContent>

          <TabsContent value="behaviour" className="space-y-section">
            <div className="grid gap-section lg:grid-cols-2">
              <FunnelCard rows={(funnel.data ?? []) as FunnelRow[]} />
              <MetricsCard
                title="Draft quality and trust"
                note="Edit distance is how much of the generated draft the user rewrote. 0% means it shipped verbatim, above 50% means they effectively started over. Rising regenerations per draft is the earliest signal the model has stopped being useful."
                rows={(ai.data ?? []) as MetricRow[]}
              />
              <MetricsCard
                title="Is the output read?"
                note="Read rate compares distinct calendars opened against calendars that completed in the same window. A low number means you are generating content nobody reviews."
                rows={(reading.data ?? []) as MetricRow[]}
              />
              <MetricsCard
                title="Session quality"
                note="A dead-end session is one where somebody looked around and did nothing. High numbers point at navigation or discovery problems rather than broken features."
                rows={(sessions.data ?? []) as MetricRow[]}
              />
            </div>
          </TabsContent>

          <TabsContent value="features" className="space-y-section">
            <FeatureTable rows={(features.data ?? []) as FeatureRow[]} />
          </TabsContent>

          <TabsContent value="people" className="space-y-section">
          <Card>
            <CardHeader>
              <CardTitle className="t-h3">Per user</CardTitle>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="text-right">Reports</TableHead>
                      <TableHead className="text-right">Posts</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Active days</TableHead>
                      <TableHead>Last active</TableHead>
                      <TableHead>Last sign-in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((u) => (
                      <TableRow
                      key={u.email}
                      onClick={() => setSelected({ email: u.email, name: u.name })}
                      className="cursor-pointer"
                    >
                        <TableCell>
                          <div className="t-h4">{u.name || u.email}</div>
                          <div className="t-label">
                            {u.email}
                            {u.company ? ` · ${u.company}` : ""}
                            {u.role ? ` · ${roleName(u.role)}` : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATE_STYLE[u.state] ?? ""}>
                            {usageStateName(u.state)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{u.reports_ok}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {u.posts_created + u.posts_iterated}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{u.posts_approved}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.active_days}</TableCell>
                        <TableCell className="t-label">{fmtDate(u.last_action_at)}</TableCell>
                        <TableCell className="t-label">{fmtDate(u.last_sign_in_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          </TabsContent>
        </Tabs>

        <UserDetail
          email={selected?.email ?? null}
          name={selected?.name ?? null}
          onClose={() => setSelected(null)}
        />

        <p className="t-label">
          Actions are the work the product recorded: reports, competitive analyses, posts, approvals,
          scheduling, designs and videos. Rows written before Aug 2026 mostly carry no author, so
          per-person figures before then understate real use; the totals were always complete. Page
          views and report opens are recorded separately and are not counted as actions.
        </p>
    </AppLayout>
  );
}
