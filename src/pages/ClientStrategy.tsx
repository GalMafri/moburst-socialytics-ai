/**
 * A client's content strategy (spec: docs/superpowers/specs/2026-11-02-
 * content-strategy-tab-design.md). The lifecycle writes it from the brief, the
 * trend profile, the competitors and the client's own posts, and writes it
 * again when those change and once a month; nobody has to start it. People may
 * edit any section, and a person's version is kept whenever the strategy is
 * rewritten. Staff only: the team asked for it as their own working draft.
 */

import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveClients } from "@/lib/activeClients";
import { formatDate } from "@/lib/display";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section, SectionNav } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlatformBadge } from "@/lib/platform-config";
import { StrategyCard, StrategySection, type StrategyEdit, type Written } from "@/components/strategy/StrategySection";
import { StrategyPlatforms } from "@/components/strategy/StrategyPlatforms";
import { pillarSectionKey, type WrittenPlatform } from "../../supabase/functions/_shared/strategy/platforms";

const NAV = [
  { id: "strategy-goals", label: "Goals" },
  { id: "strategy-audience", label: "Audience" },
  { id: "strategy-positioning", label: "Positioning" },
  { id: "strategy-pillars", label: "Pillars" },
  { id: "strategy-platforms", label: "Platforms" },
  { id: "strategy-avoid", label: "What to avoid" },
  { id: "strategy-measures", label: "Measures" },
];

interface StoredStrategy {
  sections: Record<string, string>;
  platforms: WrittenPlatform[];
  /** Each pillar's share of the client's calendar posts over the last 8 weeks; null with no posts then. */
  pillars: Array<{ name: string; share: number | null }>;
  sources: string[];
  /** Null while the row holds only the first write under way. */
  written_at: string | null;
}

const none = "None yet";
const number = (n: number | null | undefined) => (n === null || n === undefined ? none : Number(n).toLocaleString("en-US"));
const percent = (r: number | null | undefined) => (r === null || r === undefined ? none : `${Math.round(r * 1000) / 10}%`);

/** Another client's strategy, from the active clients. */
function ClientSwitcher({ value }: { value: string }) {
  const navigate = useNavigate();
  const { data: clients = [] } = useActiveClients("id, name");
  return (
    <Select value={value} onValueChange={(v) => navigate(`/clients/${v}/strategy`)}>
      <SelectTrigger className="w-[220px]" aria-label="Client"><SelectValue placeholder="Client" /></SelectTrigger>
      <SelectContent>
        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** The 90-day baselines code measured for each platform posting now. */
function Baselines({ platforms }: { platforms: WrittenPlatform[] }) {
  const rows = platforms.filter((p) => p.state === "posting" && p.baseline);
  if (!rows.length) return null;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Platform</TableHead>
          <TableHead className="text-right">Posts a week</TableHead>
          <TableHead className="text-right">Median engagement per post</TableHead>
          <TableHead className="text-right">Engagement rate per impression</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow key={p.key}>
            <TableCell><PlatformBadge platform={p.platform} size="sm" /></TableCell>
            <TableCell className="text-right tabular-nums">{number(p.baseline!.posts_per_week)}</TableCell>
            <TableCell className="text-right tabular-nums">{number(p.baseline!.median_engagement)}</TableCell>
            <TableCell className="text-right tabular-nums">{percent(p.baseline!.engagement_rate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ClientStrategy() {
  const { id } = useParams();
  const navigate = useNavigate();

  const client = useQuery({
    queryKey: ["strategy-client", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const strategy = useQuery({
    queryKey: ["content-strategy", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategies").select("sections, platforms, pillars, sources, written_at").eq("client_id", id!).maybeSingle();
      if (error) throw error;
      return data as unknown as StoredStrategy | null;
    },
  });
  const edits = useQuery({
    queryKey: ["content-strategy-edits", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategy_edits").select("section_key, text, editor_name, edited_at").eq("client_id", id!);
      if (error) throw error;
      return (data ?? []) as StrategyEdit[];
    },
  });

  // A row that holds only a write under way is no strategy yet.
  const s = strategy.data?.written_at ? strategy.data : null;
  const byKey = new Map((edits.data ?? []).map((e) => [e.section_key, e]));
  const written: Written = { at: s?.written_at ?? "", sources: Array.isArray(s?.sources) ? s.sources : [] };
  const sections = s?.sections ?? {};
  const common = { clientId: id!, written, onSaved: () => edits.refetch() };
  const section = (key: string) => ({ ...common, sectionKey: key, product: sections[key] ?? "", edit: byKey.get(key) });

  return (
    <AppLayout
      nav={<SectionNav items={NAV} />}
      title={client.data?.name ?? "Content strategy"}
      description="The content strategy, written from the brief, the trend profile, the competitors and the client's own posts. Edit any section; your version is kept when the strategy is rewritten."
      back={
        <Button variant="ghost" size="sm" className="-ml-2 border-0 bg-transparent" onClick={() => navigate(`/clients/${id}/setup`)}>
          <ArrowLeft /> Back to client
        </Button>
      }
      actions={id ? <ClientSwitcher value={id} /> : undefined}
      meta={s?.written_at ? <Badge variant="outline">Written on {formatDate(s.written_at)}</Badge> : undefined}
    >
      {strategy.isLoading || edits.isLoading ? (
        <Loading label="Loading the strategy" />
      ) : strategy.isError || edits.isError ? (
        <LoadRetry context="content strategy" error={strategy.error || edits.error} onRetry={() => { void strategy.refetch(); void edits.refetch(); }} />
      ) : !s ? (
        <EmptyState icon={Compass} title="No strategy yet" description="Written once the client's brief and trend profile are ready." />
      ) : (
        <>
          <StrategySection id="strategy-goals" title="Goals" {...section("goals")} />
          <StrategySection id="strategy-audience" title="Audience" {...section("audience")} />
          <StrategySection id="strategy-positioning" title="Positioning" {...section("positioning")} />

          <Section id="strategy-pillars" title="Pillars" description="One per content pillar from Client setup, with the formats that worked, two post ideas, and its share of the client's calendar posts over the last 8 weeks.">
            <div className="grid gap-inner lg:grid-cols-2" data-testid="strategy-pillars-grid">
              {(s.pillars ?? []).map((p) => (
                <StrategyCard
                  key={p.name}
                  {...section(pillarSectionKey(p.name))}
                  label={p.name}
                  title={p.name}
                  facts={p.share === null || p.share === undefined ? undefined : <p className="t-label">{p.share}% of calendar posts in the last 8 weeks</p>}
                />
              ))}
            </div>
          </Section>

          <Section id="strategy-platforms" title="Platforms" description="Each platform's state comes from the client's own posts, its accounts and where the industry's audience is active.">
            <StrategyPlatforms clientId={id!} platforms={s.platforms ?? []} sections={sections} edits={byKey} written={written} onSaved={common.onSaved} />
          </Section>

          <StrategySection id="strategy-avoid" title="What to avoid" {...section("avoid")} />
          <StrategySection id="strategy-measures" title="Measures" {...section("measures")}>
            <Baselines platforms={s.platforms ?? []} />
          </StrategySection>
        </>
      )}
    </AppLayout>
  );
}
