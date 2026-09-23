import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { describeInvokeError } from '@/lib/invokeError';
import { plainCompetitiveError } from '@/lib/competitiveFlow';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2 } from 'lucide-react';

type Preview = { fingerprint: string; plan: { companies: { id: string; name: string; url: string }[] }; job: { phase: string; landscape_id?: string } | null };

/**
 * What RivalIQ has done so far, and what happens next — one sentence each.
 *
 * The dialog used to name its own internal phases ("verify", "Continue
 * setup"), which told nobody whether tracking existed. Every phase now reads
 * as a state plus the next move, and the dialog offers exactly one button for
 * it.
 */
const phase: Record<string, { status: string; action?: string }> = {
 ready: { status: 'Nothing is connected yet.', action: 'Connect these companies' },
 create_requested: { status: 'Checking what RivalIQ already did with the last request.', action: 'Check again' },
 created: { status: 'RivalIQ has the tracking set. The three companies are not in it yet.', action: 'Add the companies' },
 follow_requested: { status: 'Checking whether RivalIQ added the companies.', action: 'Check again' },
 following: { status: 'RivalIQ is still adding the companies. This can take a minute.', action: 'Check again' },
 verify: { status: 'The companies are in. They still need confirming as tracked.', action: 'Confirm tracking' },
 following_failed: { status: 'RivalIQ could not track every company, so nothing has been connected.', action: 'Try again' },
 verified: { status: 'RivalIQ is tracking all three. One step left: link it to this selection.', action: 'Finish connecting' },
 complete: { status: 'Tracking is connected to this selection. Companies added just now may have little history before today.' },
};

export function RivalIqSetup({ setId, connected, onComplete }: { setId: string; connected?: boolean; onComplete: () => void }) {
 const [open, setOpen] = useState(false);
 const [busy, setBusy] = useState(false);
 const [preview, setPreview] = useState<Preview | null>(null);
 const [error, setError] = useState<string | null>(null);
 async function invoke(body: Record<string, unknown>) {
  const result = await supabase.functions.invoke('setup-rivaliq-landscape', { body: { set_id: setId, ...body } });
  if (result.error || result.data?.error) throw new Error(plainCompetitiveError(await describeInvokeError(result.error, result.data)));
  return result.data;
 }
 async function review() {
  setOpen(true); setBusy(true); setError(null); setPreview(null);
  try { setPreview(await invoke({ mode: 'preview' })); }
  catch (e) { setError(e instanceof Error ? e.message : 'Could not read the tracking state.'); }
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
   setError(e instanceof Error ? e.message : 'Could not update tracking.');
   // Recover server progress after an uncertain network response. Never
   // repeat the mutation automatically and never assume a failed POST did nothing.
   try { setPreview(await invoke({ mode: 'preview' })); } catch { /* preserve original error */ }
  } finally { setBusy(false); }
 }
 const state = preview ? phase[preview.job?.phase || 'ready'] : null;
 return <>
  <Button variant="outline" size="sm" onClick={review}>{connected ? 'Check RivalIQ tracking' : 'Connect RivalIQ tracking'}</Button>
  <Dialog open={open} onOpenChange={next => { if (!busy) setOpen(next); }}>
   <DialogContent>
    <DialogHeader>
     <DialogTitle>Step 2 · Connect RivalIQ tracking</DialogTitle>
     <DialogDescription>These are the client and the three competitors from the confirmed selection. Connecting adds them to RivalIQ so the report has data to read. An API key is enough; nobody has to sign in to RivalIQ.</DialogDescription>
    </DialogHeader>
    {busy && !preview && <p role="status"><Loader2 className="inline h-4 w-4 animate-spin" /> Reading your confirmed selection…</p>}
    {preview && <>
     <ul className="space-y-3">{preview.plan.companies.map((c, i) => <li key={c.id}>
      <p className="font-medium">{c.name} {i === 0 && <span className="text-muted-foreground">· Client</span>}</p>
      <p className="text-sm text-muted-foreground break-all">{c.url}</p>
     </li>)}</ul>
     <p className="text-sm text-muted-foreground">This uses your RivalIQ company allowance. Tracking that already matches is reused and other sets are left alone. Tracking a company does not give RivalIQ its older posts.</p>
     {state && <p role="status" className="text-sm">{state.status}</p>}
    </>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
     <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>{preview?.job?.phase === 'complete' ? 'Done' : 'Close'}</Button>
     {preview && state?.action && <Button disabled={busy} onClick={advance}>{busy ? 'Working…' : state.action}</Button>}
    </div>
   </DialogContent>
  </Dialog>
 </>;
}
