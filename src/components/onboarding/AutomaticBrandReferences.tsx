import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeading } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { platformLabel } from '@/lib/platform';
import { formatDate } from '@/lib/display';
import { sendQuietly, writeResendable } from '@/lib/quietSend';
import { checkedLine, checking, chosenLine, copyLines, lookLine, OCCASION_WORDS, ownerLine, platformLines, type PlatformLine, type RefsStep } from '@/lib/designReferences';

/**
 * The references a client's designs build on, and the look learned from
 * them. The client lifecycle checks the client's posts every week and at
 * once when the accounts change or someone keeps or leaves out a post; this
 * card only shows what is stored and saves those choices (design:
 * docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md). Opening
 * the page never starts anything (decided 19 Oct 2026), and nothing here
 * asks for a refresh.
 *
 * Whose library it is (docs/superpowers/plans/2026-11-17-reference-library.md):
 * once the team has chosen 3 or more references the designs use only those,
 * and recent everyday posts are offered with Add; until then the client's
 * everyday posts are picked on their own, and posts made for an occasion are
 * listed apart with Use anyway. All of it is read from the design_refs
 * result, so a result from before the rule shows the card as it was.
 */

type Choice = 'kept' | 'left_out';
interface Shown { path: string; platform: string | null; posted_at: string | null; source_url: string | null; upload: boolean; occasion?: string | null }

const POLL_MS = 15_000;
/** How long the card keeps reading after a saved choice for the check it started. */
const CHOICE_WAIT_MS = 10 * 60_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entryOf = (r: any, uploads: string[]): Shown => ({
  path: String(r.path),
  platform: r.upload || uploads.includes(String(r.path)) ? null : platformLabel(r.platform ?? r.network) || null,
  posted_at: r.posted_at ?? null,
  source_url: r.source_url ?? null,
  upload: r.upload === true || uploads.includes(String(r.path)),
  occasion: typeof r.occasion === 'string' ? r.occasion : null,
});
const dateLine = (e: Shown) => (e.upload ? 'Uploaded' : `${e.platform ?? 'Social'}${e.posted_at ? ` · ${formatDate(e.posted_at, { year: false })}` : ''}`);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listOf = (value: unknown, uploads: string[]): Shown[] => (Array.isArray(value) ? value : []).filter((r: any) => r && typeof r.path === 'string' && r.path).map((r: unknown) => entryOf(r, uploads));
const labelOf = (e: Shown) => (e.upload ? 'Uploaded by the team' : `${e.platform ?? 'Social'} post${e.posted_at ? `, ${formatDate(e.posted_at, { year: false })}` : ''}`);

export function AutomaticBrandReferences({ clientId, savedVersion, onReady }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientId?: string; savedVersion: number; onReady: (synthesis: any, referenceCount: number) => void;
}) {
  const [library, setLibrary] = useState<Shown[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [leftOutKnown, setLeftOutKnown] = useState<Shown[]>([]);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<Shown[]>([]);
  const [occasions, setOccasions] = useState<Shown[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [synthesis, setSynthesis] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [voice, setVoice] = useState<any>(null);
  const [step, setStep] = useState<RefsStep | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [notSaved, setNotSaved] = useState(false);
  const callback = useRef(onReady);
  callback.current = onReady;
  const lastDone = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    const [{ data: client, error: clientError }, { data: row, error: rowError }, { data: chosen, error: chosenError }] = await Promise.all([
      supabase.from('clients').select('harvested_design_references, design_style_synthesis, social_voice, design_references').eq('id', clientId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)('client_lifecycle_steps').select('status, done_at, attempted_at, result').eq('client_id', clientId).eq('step', 'design_refs').maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)('design_reference_choices').select('path, choice').eq('client_id', clientId),
    ]);
    // QA 22 Nov 2026: a read that did not answer leaves the card as it was (the next poll or visit reads
    // again); reading only `data` blanked the library and the choices on one failed poll.
    if (clientError || rowError || chosenError) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = (client ?? {}) as any;
    const uploads: string[] = Array.isArray(c.design_references) ? c.design_references.filter((p: unknown) => typeof p === 'string') : [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries: Shown[] = (Array.isArray(c.harvested_design_references) ? c.harvested_design_references : []).filter((r: any) => r?.path).map((r: unknown) => entryOf(r, uploads));
    const saved: Record<string, Choice> = Object.fromEntries(((chosen ?? []) as Array<{ path: string; choice: Choice }>).map((r) => [r.path, r.choice]));
    // Posts left out before: what the reviews know of them (an upload is known by its path).
    const unknown = Object.entries(saved).filter(([p, ch]) => ch === 'left_out' && !entries.some((e) => e.path === p)).map(([p]) => p);
    let leftOut: Shown[] = unknown.filter((p) => uploads.includes(p)).map((p) => entryOf({ path: p }, uploads));
    const asked = unknown.filter((p) => !uploads.includes(p));
    if (asked.length) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: reviews } = await (supabase.from as any)('design_reference_reviews').select('path, network, posted_at, source_url').eq('client_id', clientId).in('path', asked);
      const found = ((reviews ?? []) as Array<{ path: string }>).map((r) => entryOf(r, uploads));
      // A post the reviews no longer describe is still listed, so it can be used again.
      leftOut = [...leftOut, ...found, ...asked.filter((p) => !found.some((e) => e.path === p)).map((p) => entryOf({ path: p }, uploads))];
    }
    // What the last check offers and what it left out for an occasion; absent on a result from before the rule.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = ((row as RefsStep | null)?.result ?? {}) as any;
    const offered = listOf(result.suggestions, uploads);
    const forOccasions = listOf(result.occasions, uploads);
    setLibrary(entries);
    setChoices(saved);
    setLeftOutKnown(leftOut);
    setUploaded(uploads);
    setSuggestions(offered);
    setOccasions(forOccasions);
    setSynthesis(c.design_style_synthesis ?? null);
    setVoice(c.social_voice ?? null);
    setStep((row as RefsStep | null) ?? null);
    const doneAt = (row as RefsStep | null)?.done_at ?? null;
    if (doneAt && doneAt !== lastDone.current) {
      lastDone.current = doneAt;
      callback.current(c.design_style_synthesis ?? null, entries.length);
    }
    const paths = [...new Set([...entries, ...leftOut, ...offered, ...forOccasions].map((r) => r.path))];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('design-references').createSignedUrls(paths, 3600);
      setPreviews(Object.fromEntries((signed || []).filter((r) => r.signedUrl).map((r) => [r.path!, r.signedUrl])));
    } else {
      setPreviews({});
    }
  }, [clientId]);

  useEffect(() => { lastDone.current = null; void load(); }, [load, savedVersion]);

  /** Where the client's check stands, read on its own right after a saved choice; the polls then read the whole card. */
  const readStep = useCallback(async () => {
    if (!clientId) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: row, error } = await (supabase.from as any)('client_lifecycle_steps').select('status, done_at, attempted_at, result').eq('client_id', clientId).eq('step', 'design_refs').maybeSingle();
    if (!error && row) setStep(row as RefsStep);
  }, [clientId]);

  const busy = checking(step);
  // QA 22 Nov 2026: a saved choice starts the client's check on the server, so
  // the card reads itself again and keeps reading until that check has run
  // (the step's attempted_at moves on and it is no longer running), for at
  // most CHOICE_WAIT_MS. Before, the card never read again after a choice and
  // the check and the look it learned showed only after a reload.
  const [waitFrom, setWaitFrom] = useState<{ attempted: string | null } | null>(null);
  const awaitingCheck = waitFrom !== null && (busy || (step?.attempted_at ?? null) === waitFrom.attempted);
  useEffect(() => {
    if (waitFrom && !awaitingCheck) setWaitFrom(null);
  }, [waitFrom, awaitingCheck]);
  useEffect(() => {
    if (!waitFrom) return;
    const t = window.setTimeout(() => setWaitFrom(null), CHOICE_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [waitFrom]);
  const polling = busy || awaitingCheck;
  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [polling, load]);

  // A choice is saved at once and sent again quietly on a dropped connection.
  // One that does not get through puts the post back as it was and says so;
  // the server runs the client's check once it is saved.
  const choose = async (path: string, choice: Choice | 'none') => {
    if (!clientId) return;
    const had = choices[path];
    const asked = choice === 'none' ? undefined : choice;
    setChoices((cur) => {
      const next = { ...cur };
      if (asked) next[path] = asked; else delete next[path];
      return next;
    });
    setNotSaved(false);
    const attempted = step?.attempted_at ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.rpc as any)('design_reference_choose', { p_client: clientId, p_path: path, p_choice: choice }), { again: writeResendable });
    if (error) {
      // QA 22 Nov 2026: only this post goes back, and only if nothing changed it
      // since; putting back the whole map undid other choices saved meanwhile.
      setChoices((cur) => {
        if (cur[path] !== asked) return cur;
        const next = { ...cur };
        if (had) next[path] = had; else delete next[path];
        return next;
      });
      setNotSaved(true);
      return;
    }
    setWaitFrom((w) => w ?? { attempted });
    void readStep();
  };

  // The library, and at once any offered or occasion post someone just chose to use.
  const shown = useMemo(() => {
    const seen = new Set(library.map((e) => e.path));
    const added = [...suggestions, ...occasions].filter((e) => choices[e.path] === 'kept' && !seen.has(e.path) && seen.add(e.path));
    return [...library, ...added].filter((e) => choices[e.path] !== 'left_out');
  }, [library, suggestions, occasions, choices]);
  const inLibrary = useMemo(() => new Set(library.map((e) => e.path)), [library]);
  const offered = suggestions.filter((e) => !choices[e.path] && !inLibrary.has(e.path));
  const leftOut = useMemo(() => {
    const all = [...library, ...leftOutKnown, ...suggestions, ...occasions];
    const seen = new Set<string>();
    return all.filter((e) => choices[e.path] === 'left_out' && !seen.has(e.path) && seen.add(e.path));
  }, [library, leftOutKnown, suggestions, occasions, choices]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platforms = (step?.result as any)?.platforms as Record<string, PlatformLine> | undefined;
  const status = checkedLine(step, synthesis, library.length);
  const designLines = platformLines(platforms);
  const voiceLines = copyLines(voice);
  const look = lookLine(synthesis);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner = (step?.result as any)?.owner as unknown;
  const forOccasion = owner === 'person' ? [] : occasions.filter((e) => !choices[e.path] && !inLibrary.has(e.path));
  // What the team has chosen so far: its uploads not left out, and the posts it kept. It moves with a click.
  const chosen = uploaded.filter((p) => choices[p] !== 'left_out').length + Object.entries(choices).filter(([p, c]) => c === 'kept' && !uploaded.includes(p)).length;
  // A library the team chose is not picked per platform, so those lines are not shown for it.
  const showDesignLines = designLines.length > 0 && owner !== 'person';
  const whose = ownerLine(step);
  const progress = chosenLine(owner, chosen);

  const thumb = (e: Shown) => previews[e.path]
    ? <img src={previews[e.path]} alt="" className="aspect-square w-full rounded-[12px] object-contain bg-[rgba(255,255,255,0.04)]" />
    : <div className="aspect-square w-full rounded-[12px] bg-[rgba(255,255,255,0.04)]" />;

  return <Card>
    <CardHeading
      title="Brand references from social posts"
      description="The references this client's designs build on, and the look learned from them. Everyday posts from the client's own accounts are picked every week; posts made for a holiday, an awareness day, an event, a named person or a contest are left out. When your team chooses 3 or more references, designs use only those."
    />
    <CardContent className="space-y-3">
      {status && (busy ? <p role="status" className="t-secondary">{status}</p> : <p className="t-label">{status}</p>)}
      {whose && <p className="t-secondary">{whose}</p>}
      {progress && <p className="t-secondary">{progress}</p>}
      {look && <p className="t-secondary">{look}</p>}
      {(showDesignLines || voiceLines.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
        {showDesignLines && <div className="space-y-1">
          <p className="t-label">Designs</p>
          {designLines.map((line) => <p key={line} className="t-secondary">{line}</p>)}
        </div>}
        {voiceLines.length > 0 && <div className="space-y-1">
          <p className="t-label">Copy</p>
          {voiceLines.map((line) => <p key={line} className="t-secondary">{line}</p>)}
        </div>}
      </div>}
      {notSaved && <p role="status" className="t-secondary">That choice is not saved yet.</p>}
      {shown.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{shown.map((e) => {
        const kept = choices[e.path] === 'kept';
        return <div key={e.path} role="group" aria-label={labelOf(e)} className="space-y-1">
          {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer">{thumb(e)}</a> : thumb(e)}
          <p className="t-label">{dateLine(e)}</p>
          <div className="flex flex-wrap gap-1">
            {!e.upload && <Button type="button" size="sm" variant={kept ? 'default' : 'outline'} aria-pressed={kept} onClick={() => void choose(e.path, kept ? 'none' : 'kept')}>
              {kept && <Check />}Keep
            </Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => void choose(e.path, 'left_out')}>Leave out</Button>
          </div>
        </div>;
      })}</div>}
      {offered.length > 0 && <div className="space-y-3">
        <p className="t-label">Recent everyday posts (not used in designs)</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{offered.map((e) => <div key={e.path} role="group" aria-label={labelOf(e)} className="space-y-1">
          {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer">{thumb(e)}</a> : thumb(e)}
          <p className="t-label">{dateLine(e)}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void choose(e.path, 'kept')}>Add</Button>
        </div>)}</div>
      </div>}
      {forOccasion.length > 0 && <details className="glass-inner p-3">
        <summary className="cursor-pointer t-secondary">Left out: made for an occasion ({forOccasion.length})</summary>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{forOccasion.map((e) => <div key={e.path} role="group" aria-label={labelOf(e)} className="space-y-1">
          {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer">{thumb(e)}</a> : thumb(e)}
          <p className="t-label">{dateLine(e)}</p>
          {e.occasion && OCCASION_WORDS[e.occasion] && <p className="t-label">{OCCASION_WORDS[e.occasion]}</p>}
          <Button type="button" size="sm" variant="outline" onClick={() => void choose(e.path, 'kept')}>Use anyway</Button>
        </div>)}</div>
      </details>}
      {leftOut.length > 0 && <details className="glass-inner p-3">
        <summary className="cursor-pointer t-secondary">Left out ({leftOut.length})</summary>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">{leftOut.map((e) => <div key={e.path} role="group" aria-label={labelOf(e)} className="space-y-1">
          {thumb(e)}
          <p className="t-label">{e.upload ? 'Uploaded' : `${e.platform ?? 'Social'}${e.posted_at ? ` · ${formatDate(e.posted_at, { year: false })}` : ''}`}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => void choose(e.path, 'none')}>Use again</Button>
        </div>)}</div>
      </details>}
    </CardContent>
  </Card>;
}
