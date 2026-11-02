// Client setup, "Trends we track": what the weekly trends collection searches
// for, for this client, and what it never keeps. The topics, the Instagram,
// TikTok and LinkedIn hashtags and the exclusions live in trend_terms, one row
// each, with the reason it is there and who put it there. The product suggests
// them from the brand details; staff add their own or remove any. Terms staff
// added stay through every new suggestion, and a removed suggestion is hidden
// and never suggested again (trend_term_remove keeps the row, marked removed).
//
// When a platform keeps too few posts two weeks running, the weekly run
// rewrites that platform's searches (trend_profiles.search_overrides). Those
// searches are shown in the group whose terms they replaced, the topics or
// Instagram's hashtags, and staff can go back to that group's terms
// (trend_search_override_clear) for one platform at a time.
//
// A client with no trend profile has nothing suggested yet. A change that does
// not get through is sent again quietly (src/lib/quietSend.ts); after that the
// list shows the true state and a plain line says the change is not saved yet.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, TrendingUp, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Section } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformName } from "@/lib/display";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { asHashtag } from "../../../supabase/functions/_shared/trends/hashtag.ts";
import { TREND_PLATFORMS } from "../../../supabase/functions/_shared/trends/types.ts";

interface TrendTerm {
  id: string;
  kind: string;
  platform: string | null;
  term: string;
  reason: string;
  source: string;
}

/** The searches the coverage rewrite gave one platform, in place of the profile's own terms there. */
interface Rewrite {
  platform: string;
  searches: string[];
}

/** Where a term came from (trend_terms.source), as people read it. */
const ORIGIN: Record<string, string> = {
  lifecycle: "Suggested",
  person: "Added by your team",
  dismissal: "From a dismissed trend",
};

interface GroupSpec {
  heading: string;
  /** What one term of the group is called, in the add box and the remove buttons. */
  noun: string;
  kind: "topic" | "hashtag" | "exclusion";
  /** The platform of a hashtag group; topics and exclusions belong to no platform. */
  platform: string | null;
  help?: string;
}

const COME_FIRST = "Your team's come first; the rest take turns.";

const GROUPS: GroupSpec[] = [
  { heading: "Topics", noun: "topic", kind: "topic", platform: null, help: `Searched every week on each platform except Instagram, up to 8 a week. ${COME_FIRST}` },
  { heading: "Instagram hashtags", noun: "Instagram hashtag", kind: "hashtag", platform: "instagram", help: `Searched every week on Instagram, up to 8 a week. ${COME_FIRST}` },
  // TikTok's and LinkedIn's hashtags are not searched: the weekly calendar suggests them for its posts there.
  { heading: "TikTok hashtags", noun: "TikTok hashtag", kind: "hashtag", platform: "tiktok", help: "Suggested for TikTok posts in the weekly calendar. Trends on TikTok are searched by topic." },
  { heading: "LinkedIn hashtags", noun: "LinkedIn hashtag", kind: "hashtag", platform: "linkedin", help: "Suggested for LinkedIn posts in the weekly calendar. Trends on LinkedIn are searched by topic." },
  { heading: "Exclusions", noun: "exclusion", kind: "exclusion", platform: null, help: "The filter never keeps posts about these." },
];

/**
 * The rewrites a group's terms were replaced by: Instagram searches its
 * hashtags, every other platform searches the topics.
 */
function rewritesFor(spec: GroupSpec, rewrites: Rewrite[]): Rewrite[] {
  if (spec.kind === "topic") return rewrites.filter((r) => r.platform !== "instagram");
  if (spec.kind === "hashtag" && spec.platform === "instagram") return rewrites.filter((r) => r.platform === "instagram");
  return [];
}

/** Each platform's rewritten searches, as stored ({platform: [search]}); a platform with no text search has none. */
function readRewrites(stored: unknown): Rewrite[] {
  const byPlatform = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return TREND_PLATFORMS.map((platform) => {
    const list = byPlatform[platform];
    const searches = (Array.isArray(list) ? list : []).filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim());
    return { platform, searches };
  }).filter((r) => r.searches.length > 0);
}

/**
 * What a typed term is sent as. A hashtag is one tag, by the one hashtag rule
 * every Trends step follows: one # and then letters, digits and underscores
 * only, everything else taken out; a tag with nothing left is no term. (A
 * phrase such as "car accident lawyer" would otherwise be stored as one
 * hashtag with spaces and take one of Instagram's weekly search slots.)
 * Topics and exclusions are sent as typed, trimmed.
 */
function termToSend(spec: GroupSpec, typed: string): string {
  return spec.kind === "hashtag" ? asHashtag(typed) : typed.trim();
}

const termsKey = (clientId: string) => ["trend-terms", clientId];

/** One platform's rewritten searches, and the way back to the group's own terms. */
function RewrittenSearches({ rewrite, replaced, onRestore }: {
  rewrite: Rewrite;
  /** What the rewrite replaced on this platform: "topics" or "hashtags". */
  replaced: string;
  onRestore: (platform: string) => Promise<unknown>;
}) {
  const [restoring, setRestoring] = useState(false);
  const name = platformName(rewrite.platform);
  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    await onRestore(rewrite.platform);
    setRestoring(false);
  };
  return (
    <div role="group" aria-label={`Searches on ${name}`} className="space-y-2 rounded-md bg-[rgba(255,255,255,0.03)] p-3.5">
      <p className="t-secondary">Trends on {name} are searched with these terms this week, because the {replaced} found too little:</p>
      <ul className="flex flex-wrap gap-1.5">
        {rewrite.searches.map((s) => (
          <li key={s}><Badge variant="outline" className="t-body py-1">{s}</Badge></li>
        ))}
      </ul>
      <Button variant="outline" size="sm" disabled={restoring} onClick={() => void restore()}>Go back to the {replaced}</Button>
    </div>
  );
}

function TermGroup({ spec, terms, rewrites, onAdd, onRemove, onRestore }: {
  spec: GroupSpec;
  terms: TrendTerm[];
  /** The platforms whose searches of this group's terms a coverage rewrite replaced. */
  rewrites: Rewrite[];
  /** Resolves true when the term was saved. */
  onAdd: (spec: GroupSpec, term: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<unknown>;
  onRestore: (platform: string) => Promise<unknown>;
}) {
  const [typed, setTyped] = useState("");
  const [adding, setAdding] = useState(false);

  const add = async () => {
    const term = termToSend(spec, typed);
    // Nothing to send (a blank box, a bare #): the box stays as it is, with no message.
    if (!term || adding) return;
    const sentFrom = typed;
    setAdding(true);
    // What was typed stays in the box until it is saved.
    if (await onAdd(spec, term)) setTyped((now) => (now === sentFrom ? "" : now));
    setAdding(false);
  };

  return (
    <div role="group" aria-label={spec.heading} className="space-y-2">
      <Label>{spec.heading}</Label>
      {spec.help && <p className="t-secondary">{spec.help}</p>}
      {terms.length > 0 && (
        <ul className="space-y-2">
          {terms.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1">
              <Badge variant="outline" className="gap-1.5 pr-1 t-body py-1">
                {t.term}
                <button type="button" aria-label={`Remove ${spec.noun} ${t.term}`} onClick={() => void onRemove(t.id)}
                  className="rounded-full p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                  <X className="h-3 w-3" />
                </button>
              </Badge>
              <p className="t-label min-w-0 flex-1 basis-56 pt-1.5">
                <span className="text-white">{ORIGIN[t.source] ?? ORIGIN.lifecycle}</span>
                {t.reason ? `: ${t.reason}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={`Add ${spec.noun} (press Enter)`} aria-label={`New ${spec.noun}`}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void add())} />
        <Button variant="outline" size="icon" onClick={() => void add()} aria-label={`Add ${spec.noun}`}>
          <Plus aria-hidden="true" />
        </Button>
      </div>
      {rewrites.map((r) => (
        <RewrittenSearches key={r.platform} rewrite={r} replaced={spec.kind === "topic" ? "topics" : "hashtags"} onRestore={onRestore} />
      ))}
    </div>
  );
}

export function TrendsWeTrack({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [notSaved, setNotSaved] = useState(false);

  // Staff read both tables directly (the read policies are staff's), and only the terms nobody removed.
  const { data, isError, error, refetch } = useQuery({
    queryKey: termsKey(clientId),
    queryFn: async () => {
      const [profile, terms] = await Promise.all([
        supabase.from("trend_profiles").select("client_id, search_overrides").eq("client_id", clientId).maybeSingle(),
        supabase.from("trend_terms").select("id, kind, platform, term, reason, source").eq("client_id", clientId).is("removed_at", null).order("created_at", { ascending: true }),
      ]);
      if (profile.error) throw profile.error;
      if (terms.error) throw terms.error;
      return { hasProfile: !!profile.data, rewrites: readRewrites(profile.data?.search_overrides), terms: (terms.data ?? []) as TrendTerm[] };
    },
  });

  // Every change can be asked twice with the same result, so a request that does not get through is sent again
  // quietly. The list is read again either way, so it shows what is true.
  const refresh = () => queryClient.invalidateQueries({ queryKey: termsKey(clientId) });
  const addTerm = useMutation({
    mutationFn: async (v: { kind: string; platform: string | null; term: string }) => {
      // The database function puts a hashtag's "#" on itself, and reads an empty platform as none.
      const { error: failed } = await sendQuietly(() => supabase.rpc("trend_term_add", { p_client: clientId, p_kind: v.kind, p_platform: v.platform ?? "", p_term: v.term }), { again: writeResendable });
      if (failed) throw failed;
    },
    onSettled: refresh,
  });
  const removeTerm = useMutation({
    mutationFn: async (id: string) => {
      const { error: failed } = await sendQuietly(() => supabase.rpc("trend_term_remove", { p_id: id }), { again: writeResendable });
      if (failed) throw failed;
    },
    onSettled: refresh,
  });
  const clearRewrite = useMutation({
    mutationFn: async (platform: string) => {
      // trend_search_override_clear is newer than the generated types.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: failed } = await sendQuietly(() => (supabase.rpc as any)("trend_search_override_clear", { p_client: clientId, p_platform: platform }), { again: writeResendable });
      if (failed) throw failed;
    },
    onSettled: refresh,
  });

  const change = async (send: () => Promise<unknown>): Promise<boolean> => {
    setNotSaved(false);
    try {
      await send();
      return true;
    } catch (e) {
      console.warn("[trends we track] not saved yet", e);
      setNotSaved(true);
      return false;
    }
  };
  const onAdd = (spec: GroupSpec, term: string) => change(() => addTerm.mutateAsync({ kind: spec.kind, platform: spec.platform, term }));
  const onRemove = (id: string) => change(() => removeTerm.mutateAsync(id));
  const onRestore = (platform: string) => change(() => clearRewrite.mutateAsync(platform));

  const terms = data?.terms ?? [];
  return (
    <Section
      layout="split"
      eyebrow="Trends"
      title="Trends we track"
      description="What the weekly trends collection searches for and leaves out, and the hashtags suggested for the calendar. Your team's additions always come first."
    >
      {!data ? (
        // A list that did not answer says nothing about the client's trends: keep loading, quietly, and fill in when a try answers.
        isError
          ? <LoadRetry context="trends we track" error={error} label="Loading trends we track" onRetry={() => refetch()} />
          : <Loading label="Loading trends we track" />
      ) : !data.hasProfile && terms.length === 0 ? (
        <EmptyState compact icon={TrendingUp} title="Suggestions appear here once the brand details are read." />
      ) : (
        GROUPS.map((spec) => (
          <TermGroup
            key={`${spec.kind}-${spec.platform ?? ""}`}
            spec={spec}
            terms={terms.filter((t) => t.kind === spec.kind && (t.platform ?? null) === spec.platform)}
            rewrites={rewritesFor(spec, data.rewrites)}
            onAdd={onAdd}
            onRemove={onRemove}
            onRestore={onRestore}
          />
        ))
      )}
      {notSaved && <p role="status" className="t-label">That change is not saved yet.</p>}
    </Section>
  );
}
