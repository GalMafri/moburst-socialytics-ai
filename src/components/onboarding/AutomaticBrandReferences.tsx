import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeading } from '@/components/ui/card';
import { Check } from 'lucide-react';
import { platformLabel } from '@/lib/platform';
import { formatDate } from '@/lib/display';
import { sendQuietly, writeResendable } from '@/lib/quietSend';
import { checkedLine, checking, copyLines, lookLine, platformLines, type PlatformLine, type RefsStep } from '@/lib/designReferences';

/**
 * The client's designed posts per platform, from its own published posts,
 * and the look learned from them. The client lifecycle checks them every
 * week and at once when the accounts change or someone keeps or leaves out a
 * post; this card only shows what is stored and saves those choices (design:
 * docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md). Opening
 * the page never starts anything (Lital, 19 Oct 2026), and nothing here asks
 * for a refresh: the references follow the client's posts on their own.
 */

type Choice = 'kept' | 'left_out';
interface Shown { path: string; platform: string | null; posted_at: string | null; source_url: string | null; upload: boolean }

const POLL_MS = 15_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const entryOf = (r: any, uploads: string[]): Shown => ({
  path: String(r.path),
  platform: r.upload || uploads.includes(String(r.path)) ? null : platformLabel(r.platform ?? r.network) || null,
  posted_at: r.posted_at ?? null,
  source_url: r.source_url ?? null,
  upload: r.upload === true || uploads.includes(String(r.path)),
});
const labelOf = (e: Shown) => (e.upload ? 'Uploaded by the team' : `${e.platform ?? 'Social'} post${e.posted_at ? `, ${formatDate(e.posted_at, { year: false })}` : ''}`);

export function AutomaticBrandReferences({ clientId, savedVersion, onReady }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientId?: string; savedVersion: number; onReady: (synthesis: any, referenceCount: number) => void;
}) {
  const [library, setLibrary] = useState<Shown[]>([]);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [leftOutKnown, setLeftOutKnown] = useState<Shown[]>([]);
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
    const [{ data: client }, { data: row }, { data: chosen }] = await Promise.all([
      supabase.from('clients').select('harvested_design_references, design_style_synthesis, social_voice, design_references').eq('id', clientId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)('client_lifecycle_steps').select('status, done_at, attempted_at, result').eq('client_id', clientId).eq('step', 'design_refs').maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)('design_reference_choices').select('path, choice').eq('client_id', clientId),
    ]);
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
    setLibrary(entries);
    setChoices(saved);
    setLeftOutKnown(leftOut);
    setSynthesis(c.design_style_synthesis ?? null);
    setVoice(c.social_voice ?? null);
    setStep((row as RefsStep | null) ?? null);
    const doneAt = (row as RefsStep | null)?.done_at ?? null;
    if (doneAt && doneAt !== lastDone.current) {
      lastDone.current = doneAt;
      callback.current(c.design_style_synthesis ?? null, entries.length);
    }
    const paths = [...new Set([...entries, ...leftOut].map((r) => r.path))];
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('design-references').createSignedUrls(paths, 3600);
      setPreviews(Object.fromEntries((signed || []).filter((r) => r.signedUrl).map((r) => [r.path!, r.signedUrl])));
    } else {
      setPreviews({});
    }
  }, [clientId]);

  useEffect(() => { lastDone.current = null; void load(); }, [load, savedVersion]);

  const busy = checking(step);
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [busy, load]);

  // A choice is saved at once and sent again quietly on a dropped connection.
  // One that does not get through puts the post back as it was and says so;
  // the server runs the client's check once it is saved.
  const choose = async (path: string, choice: Choice | 'none') => {
    if (!clientId) return;
    const before = choices;
    const next = { ...choices };
    if (choice === 'none') delete next[path]; else next[path] = choice;
    setChoices(next);
    setNotSaved(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.rpc as any)('design_reference_choose', { p_client: clientId, p_path: path, p_choice: choice }), { again: writeResendable });
    if (error) {
      setChoices(before);
      setNotSaved(true);
    }
  };

  const shown = library.filter((e) => choices[e.path] !== 'left_out');
  const leftOut = useMemo(() => {
    const all = [...library, ...leftOutKnown];
    const seen = new Set<string>();
    return all.filter((e) => choices[e.path] === 'left_out' && !seen.has(e.path) && seen.add(e.path));
  }, [library, leftOutKnown, choices]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platforms = (step?.result as any)?.platforms as Record<string, PlatformLine> | undefined;
  const status = checkedLine(step, synthesis, library.length);
  const designLines = platformLines(platforms);
  const voiceLines = copyLines(voice);
  const look = lookLine(synthesis);

  const thumb = (e: Shown) => previews[e.path]
    ? <img src={previews[e.path]} alt="" className="aspect-square w-full rounded-[12px] object-contain bg-[rgba(255,255,255,0.04)]" />
    : <div className="aspect-square w-full rounded-[12px] bg-[rgba(255,255,255,0.04)]" />;

  return <Card>
    <CardHeading
      title="Brand references from social posts"
      description="Designed posts from this client's own accounts, newest first on each platform, and the look learned from them. They follow the client's posts on their own: checked every week, and at once when the accounts change or someone keeps or leaves out a post."
    />
    <CardContent className="space-y-3">
      {status && (busy ? <p role="status" className="t-secondary">{status}</p> : <p className="t-label">{status}</p>)}
      {look && <p className="t-secondary">{look}</p>}
      {(designLines.length > 0 || voiceLines.length > 0) && <div className="grid gap-3 sm:grid-cols-2">
        {designLines.length > 0 && <div className="space-y-1">
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
          <p className="t-label">{e.upload ? 'Uploaded' : `${e.platform ?? 'Social'}${e.posted_at ? ` · ${formatDate(e.posted_at, { year: false })}` : ''}`}</p>
          <div className="flex flex-wrap gap-1">
            {!e.upload && <Button type="button" size="sm" variant={kept ? 'default' : 'outline'} aria-pressed={kept} onClick={() => void choose(e.path, kept ? 'none' : 'kept')}>
              {kept && <Check />}Keep
            </Button>}
            <Button type="button" size="sm" variant="ghost" onClick={() => void choose(e.path, 'left_out')}>Leave out</Button>
          </div>
        </div>;
      })}</div>}
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
