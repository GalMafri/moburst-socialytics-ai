/**
 * A client's social strategy (spec: docs/superpowers/specs/2026-11-03-
 * strategy-v2-design.md). The lifecycle writes it from the brief, the trend
 * profile, the competitors and the client's own posts (Sprout where profiles
 * are assigned, public posts everywhere else), and writes it again when those
 * change and once a month; nobody has to start it. It reads as cards, lists
 * and numbers in six band sections; each card's pencil opens its fields, and
 * a person's version is kept whenever the strategy is rewritten. Staff only;
 * the client gets the PDF or the Google Slides deck.
 */

import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Compass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveClients } from "@/lib/activeClients";
import { AppLayout } from "@/components/layout/AppLayout";
import { Section, SectionNav } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { newestEdit, type PageStrategy, type StrategyEdit } from "@/lib/strategyView";
import { StrategyHeader } from "@/components/strategy/StrategyHeader";
import { GoalCards, PlanTiles } from "@/components/strategy/GoalCards";
import { Measures, PlatformStart } from "@/components/strategy/Baseline";
import { AudienceCard, PositioningCard } from "@/components/strategy/AudiencePosition";
import { MixChart, PillarCard } from "@/components/strategy/PillarMix";
import { NotNow, PlatformCard } from "@/components/strategy/PlatformCard";
import { AvoidList } from "@/components/strategy/AvoidList";
import { StrategyExports } from "@/components/strategy/StrategyExports";
import { pillarSectionKey, platformSectionKey } from "../../supabase/functions/_shared/strategy/platforms";
import type { Goal } from "../../supabase/functions/_shared/strategy/sections";

const NAV = [
  { id: "strategy-plan", label: "The plan" },
  { id: "strategy-start", label: "Where we start" },
  { id: "strategy-audience", label: "Audience and positioning" },
  { id: "strategy-pillars", label: "Pillars" },
  { id: "strategy-platforms", label: "Platforms" },
  { id: "strategy-avoid", label: "What we avoid" },
];

/** Another client's strategy, from the active clients. */
function ClientSwitcher({ value }: { value: string }) {
  const navigate = useNavigate();
  const { data: clients = [] } = useActiveClients("id, name");
  return (
    <div data-print="hide">
      <Select value={value} onValueChange={(v) => navigate(`/clients/${v}/strategy`)}>
        <SelectTrigger className="w-[220px]" aria-label="Client"><SelectValue placeholder="Client" /></SelectTrigger>
        <SelectContent>
          {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

/** The strategy's six sections, from the stored strategy and people's versions. */
export function StrategyBody({ clientId, client, logo, strategy, edits, onSaved }: {
  clientId: string;
  client: string;
  logo: string | null;
  strategy: PageStrategy;
  edits: StrategyEdit[];
  onSaved: () => unknown;
}) {
  const byKey = new Map(edits.map((e) => [e.section_key, e]));
  const sections = strategy.sections ?? {};
  const section = (key: string) => ({ clientId, sectionKey: key, product: sections[key] ?? "", edit: byKey.get(key), onSaved });
  const platforms = Array.isArray(strategy.platforms) ? strategy.platforms : [];
  const live = platforms.filter((p) => p.state !== "not_now");
  const pillars = Array.isArray(strategy.pillars) ? strategy.pillars : [];
  const goalsValue = byKey.get("goals")?.value ?? sections.goals;
  const goals = goalsValue && typeof goalsValue === "object" && Array.isArray((goalsValue as { items?: unknown }).items) ? (goalsValue as { items: Goal[] }).items : [];
  const hasNotNow = platforms.some((p) => p.state === "not_now") || byKey.has("not_now") || !!sections.not_now;
  return (
    <>
      <StrategyHeader client={client} logo={logo} writtenAt={strategy.written_at} sources={Array.isArray(strategy.sources) ? strategy.sources : []} platforms={platforms} />

      <Section index={1} id="strategy-plan" title="The plan">
        <PlanTiles platforms={platforms} pillars={pillars.length} />
        <GoalCards {...section("goals")} />
      </Section>

      <Section index={2} id="strategy-start" title="Where we start">
        <div className="grid gap-inner lg:grid-cols-2">
          {live.map((p) => <PlatformStart key={p.key} client={client} p={p} />)}
        </div>
        <Measures {...section("measures")} platforms={platforms} goals={goals} />
      </Section>

      <Section index={3} id="strategy-audience" title="Audience and positioning">
        <div className="grid gap-inner lg:grid-cols-2">
          <AudienceCard {...section("audience")} />
          <PositioningCard {...section("positioning")} />
        </div>
      </Section>

      <Section index={4} id="strategy-pillars" title="Pillars">
        <MixChart pillars={pillars} sections={sections} edits={byKey} />
        <div className="grid gap-inner lg:grid-cols-2" data-testid="strategy-pillars-grid">
          {pillars.map((p) => <PillarCard key={p.name} name={p.name} {...section(pillarSectionKey(p.name))} />)}
        </div>
      </Section>

      <Section index={5} id="strategy-platforms" title="Platforms">
        <div className="grid gap-inner lg:grid-cols-2">
          {live.map((p) => {
            const key = platformSectionKey(p.platform, p.state === "posting" ? "posting" : "new");
            return <PlatformCard key={key} p={p} {...section(key)} />;
          })}
        </div>
        {hasNotNow && <NotNow {...section("not_now")} />}
      </Section>

      <Section index={6} id="strategy-avoid" title="What we avoid">
        <AvoidList {...section("avoid")} />
      </Section>
    </>
  );
}

export default function ClientStrategy() {
  const { id } = useParams();
  const navigate = useNavigate();
  const contentRef = useRef<HTMLDivElement>(null);

  const client = useQuery({
    queryKey: ["strategy-client", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, logo_url").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const strategy = useQuery({
    queryKey: ["content-strategy", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategies").select("shape, sections, platforms, pillars, sources, written_at").eq("client_id", id!).maybeSingle();
      if (error) throw error;
      return data as unknown as PageStrategy | null;
    },
  });
  const edits = useQuery({
    queryKey: ["content-strategy-edits", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("content_strategy_edits").select("section_key, text, value, editor_name, edited_at, source").eq("client_id", id!);
      if (error) throw error;
      return (data ?? []) as StrategyEdit[];
    },
  });

  // A row that holds only a write under way is no strategy yet.
  const s = strategy.data?.written_at ? strategy.data : null;
  const name = client.data?.name ?? "";
  const logo = typeof client.data?.logo_url === "string" && /^https:\/\//.test(client.data.logo_url) ? client.data.logo_url : null;

  return (
    <AppLayout
      nav={<SectionNav items={NAV} />}
      title={name || "Social strategy"}
      back={
        <Button variant="ghost" size="sm" className="-ml-2 border-0 bg-transparent" onClick={() => navigate(`/clients/${id}/setup`)} data-print="hide">
          <ArrowLeft /> Back to client
        </Button>
      }
      actions={id ? (
        <div className="flex flex-wrap items-start gap-2">
          <ClientSwitcher value={id} />
          {s && <StrategyExports clientId={id} client={name} writtenAt={s.written_at} newestEdit={newestEdit(edits.data ?? [])} contentRef={contentRef} />}
        </div>
      ) : undefined}
    >
      {strategy.isLoading || edits.isLoading ? (
        <Loading label="Loading the strategy" />
      ) : strategy.isError || edits.isError ? (
        <LoadRetry context="content strategy" error={strategy.error || edits.error} onRetry={() => { void strategy.refetch(); void edits.refetch(); }} />
      ) : !s ? (
        <EmptyState icon={Compass} title="No strategy yet" description="Written once the client's brief and trend profile are ready." />
      ) : (
        <div ref={contentRef} className="space-y-section">
          <StrategyBody clientId={id!} client={name} logo={logo} strategy={s} edits={edits.data ?? []} onSaved={() => edits.refetch()} />
        </div>
      )}
    </AppLayout>
  );
}
