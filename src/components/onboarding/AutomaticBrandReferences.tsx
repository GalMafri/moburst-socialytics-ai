import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import { describeInvokeError } from '@/lib/invokeError';

// React remounts share the same request instead of spending twice.
const pending = new Map<string, Promise<any>>();
export function AutomaticBrandReferences({ clientId, savedVersion, onReady }: {
  clientId?: string; savedVersion: number; onReady: (synthesis: any) => void;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [refs, setRefs] = useState<any[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const callback = useRef(onReady);
  callback.current = onReady;
  const run = async (force = false) => {
    if (!clientId) return;
    setRunning(true); setError('');
    try {
      let request = pending.get(clientId);
      if (!request) {
        request = (async () => {
          const { data, error } = await supabase.functions.invoke('synthesize-design-language', {
            body: { client_id: clientId, discover: true, force },
          });
          if (error || data?.error) throw new Error(await describeInvokeError(error, data));
          return data;
        })();
        pending.set(clientId, request);
        request.finally(() => pending.delete(clientId)).catch(() => {});
      }
      const data = await request;
      setRefs(data.harvested_design_references || []);
      callback.current(data.design_style_synthesis);
      const paths = (data.harvested_design_references || []).map((r: any) => r.path);
      if (paths.length) {
        const { data: signed } = await supabase.storage.from('design-references').createSignedUrls(paths, 3600);
        setPreviews(Object.fromEntries((signed || []).filter(r => r.signedUrl).map(r => [r.path!, r.signedUrl])));
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not discover references. Please retry.'); }
    finally { setRunning(false); }
  };
  useEffect(() => { void run(); }, [clientId, savedVersion]); // saved assignments are the source of truth
  return <Card><CardContent className="pt-5 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-semibold">Brand references from social posts</h3>
      <Button variant="outline" size="sm" disabled={!clientId || running} onClick={() => run(true)}>
        {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
        Refresh references
      </Button>
    </div>
    <p className="t-secondary">We identify branded designs in this client’s published social posts and learn their visual style automatically. No uploads required.</p>
    {!clientId && <p className="t-secondary">Choose the client’s social accounts and save to start.</p>}
    {running && <p role="status" className="t-secondary">Finding and reviewing published designs, then learning the brand style… This can take a few minutes.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!running && !error && refs.length > 0 && <p role="status" className="text-sm">{refs.length} branded references identified and used for generation.</p>}
    <div className="grid grid-cols-4 gap-2">{refs.map(ref => <a key={ref.path} href={ref.source_url} target="_blank" rel="noreferrer" className="space-y-1" title={ref.classification}>
      {previews[ref.path] && <img src={previews[ref.path]} alt={`${ref.platform} brand reference`} className="aspect-square w-full rounded object-contain bg-muted" />}
      <span className="text-xs underline">View {ref.platform} post</span>
    </a>)}</div>
  </CardContent></Card>;
}
