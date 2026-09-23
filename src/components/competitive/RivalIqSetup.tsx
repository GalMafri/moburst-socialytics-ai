import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { describeInvokeError } from '@/lib/invokeError';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

type Preview = { fingerprint: string; plan: { companies: { id: string; name: string; url: string }[] }; job: { phase: string; landscape_id?: string } | null };
const phaseLabel: Record<string, string> = {
 ready: 'Ready to connect', create_requested: 'Checking whether the landscape was created',
 created: 'Landscape created. Continue to add the reviewed companies.',
 follow_requested: 'Checking whether RivalIQ added the companies',
 following: 'RivalIQ is preparing company tracking', verify: 'Ready to verify tracked companies',
 following_failed: 'RivalIQ could not track every company. This selection has not been connected.',
 verified: 'Tracking verified. Continue to link it to this selection.', complete: 'Tracking verified and connected',
};

export function RivalIqSetup({ setId, onComplete }: { setId: string; onComplete: () => void }) {
 const [open, setOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const [preview, setPreview] = useState<Preview | null>(null);
 const [error, setError] = useState<string | null>(null);
 async function invoke(body: Record<string, unknown>) {
  const result = await supabase.functions.invoke('setup-rivaliq-landscape', { body: { set_id: setId, ...body } });
  if (result.error || result.data?.error) throw new Error(await describeInvokeError(result.error, result.data));
  return result.data;
 }
 async function review() {
  setOpen(true); setBusy(true); setError(null); setPreview(null);
  try { setPreview(await invoke({ mode: 'preview' })); }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not read setup'); }
  finally { setBusy(false); }
 }
 async function advance() {
  if (!preview) return;
  setBusy(true); setError(null);
  try {
   for (let step = 0; step < 3; step++) {
    const result = await invoke({ mode: 'advance', fingerprint: preview.fingerprint });
    setPreview({ ...preview, job: result.job });
    if (result.job.phase === 'complete') { onComplete(); break; }
    if (!['created', 'verify', 'verified'].includes(result.job.phase)) break;
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : 'Could not update tracking');
   // Recover server progress after an uncertain network response. Never
   // repeat the mutation automatically and never assume a failed POST did nothing.
   try { setPreview(await invoke({ mode: 'preview' })); } catch { /* preserve original error */ }
  } finally { setBusy(false); }
 }
 return <>
  <Button variant="outline" size="sm" onClick={review}>Set up RivalIQ tracking</Button>
  <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
   <DialogContent>
    <DialogHeader>
     <DialogTitle>Connect competitive tracking</DialogTitle>
     <DialogDescription>Review the client and three competitors before adding them to RivalIQ. An API key is sufficient; no RivalIQ sign-in is needed.</DialogDescription>
    </DialogHeader>
    {busy && !preview && <p role="status"><Loader2 className="inline h-4 w-4 animate-spin" /> Reading your confirmed selection…</p>}
    {preview && <>
     <ul className="space-y-3">{preview.plan.companies.map((c, i) => <li key={c.id}>
      <p className="font-medium">{c.name} {i === 0 && <span className="text-muted-foreground">· Client</span>}</p>
      <p className="text-sm text-muted-foreground break-all">{c.url}</p>
     </li>)}</ul>
     <p className="text-sm text-muted-foreground">This uses your RivalIQ company allowance. Existing matching tracking is reused; other landscapes are left intact. Newly added companies may have limited historical data.</p>
     {preview.job && <p role="status">{phaseLabel[preview.job.phase] || 'Check setup status'}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
     <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{preview?.job?.phase === 'complete' ? 'Done' : 'Close'}</Button>
     {preview && preview.job?.phase !== 'complete' && <Button disabled={busy} onClick={advance}>
      {busy ? 'Checking…' : !preview.job || preview.job.phase === 'ready' ? 'Connect these companies' : ['created','verified'].includes(preview.job.phase) ? 'Continue setup' : 'Check status'}
     </Button>}
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
