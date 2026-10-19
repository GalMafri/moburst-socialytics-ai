import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { platformLabel } from '@/lib/platform';

/**
 * The client's branded designs from its own published posts, and the style
 * learned from them. The client lifecycle keeps these current on the server
 * (when the accounts change, and every 90 days); this card only shows what is
 * stored. Opening the page never starts discovery (Lital, 19 Oct 2026).
 */

interface StepRow { status: 'running' | 'done' | 'waiting' | 'failed'; done_at: string | null }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reference = any;

const POLL_MS = 15_000;
const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function AutomaticBrandReferences({ clientId, savedVersion, onReady }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientId?: string; savedVersion: number; onReady: (synthesis: any, referenceCount: number) => void;
}) {
  const [refs, setRefs] = useState<Reference[]>([]);
  const [step, setStep] = useState<StepRow | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const callback = useRef(onReady);
  callback.current = onReady;
  const lastDone = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    const [{ data: client }, { data: row }] = await Promise.all([
      supabase.from('clients').select('harvested_design_references, design_style_synthesis').eq('id', clientId).maybeSingle(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from as any)('client_lifecycle_steps').select('status, done_at').eq('client_id', clientId).eq('step', 'design_refs').maybeSingle(),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stored: Reference[] = Array.isArray((client as any)?.harvested_design_references) ? (client as any).harvested_design_references : [];
    setRefs(stored);
    setStep((row as StepRow | null) ?? null);
    const doneAt = (row as StepRow | null)?.done_at ?? null;
    if (doneAt && doneAt !== lastDone.current) {
      lastDone.current = doneAt;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      callback.current((client as any)?.design_style_synthesis ?? null, stored.length);
    }
    const paths = stored.map((r) => r.path).filter(Boolean);
    if (paths.length) {
      const { data: signed } = await supabase.storage.from('design-references').createSignedUrls(paths, 3600);
      setPreviews(Object.fromEntries((signed || []).filter((r) => r.signedUrl).map((r) => [r.path!, r.signedUrl])));
    } else {
      setPreviews({});
    }
  }, [clientId]);

  useEffect(() => { lastDone.current = null; void load(); }, [load, savedVersion]);

  const running = step?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [running, load]);

  // Asking only queues work on the server. A request that does not get through
  // (a dropped connection) is sent again quietly; nothing here shows a failure.
  const refresh = async () => {
    if (!clientId) return;
    setAsking(true);
    for (const wait of [0, 2000, 5000, 15000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('lifecycle_request', { p_client: clientId, p_step: 'design_refs' });
      if (!error) {
        setStep((s) => ({ status: 'running', done_at: s?.done_at ?? null }));
        break;
      }
    }
    setAsking(false);
  };

  return <Card><CardContent className="pt-5 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">Brand references from social posts</h3>
      {clientId && <Button variant="outline" size="sm" disabled={running || asking} onClick={refresh}>
        {running || asking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        Refresh references
      </Button>}
    </div>
    <p className="t-secondary">Branded designs from this client's published posts, and the visual style learned from them. They update on their own when the client's accounts change and every three months.</p>
    {running && <p role="status" className="t-secondary">Reviewing the client's published posts and learning its style.</p>}
    {!running && refs.length > 0 && step?.done_at && <p role="status" className="text-sm">{refs.length} branded references, learned {longDate(step.done_at)}.</p>}
    {refs.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{refs.map((ref) => <a key={ref.path} href={ref.source_url} target="_blank" rel="noreferrer" className="space-y-1" title={ref.classification}>
      {previews[ref.path] && <img src={previews[ref.path]} alt={`${platformLabel(ref.platform)} brand reference`} className="aspect-square w-full rounded object-contain bg-muted" />}
      <span className="text-xs underline">View {platformLabel(ref.platform)} post</span>
    </a>)}</div>}
  </CardContent></Card>;
}
