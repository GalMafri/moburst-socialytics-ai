import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Palette, RefreshCw, CheckCircle2 } from 'lucide-react';
import { approveLibrary, facesOf, fetchLibraryBuild, postUrl, startLibraryBuild, stepLibraryBuild, type LibraryBuild } from '@/lib/socialTemplates';
import { fetchDesignSystems, type ClientDesignSystem } from '@/lib/designSystem';

const FORMAT_LABEL: Record<string, string> = { '4:5': 'Feed 4:5', '1:1': 'Square', '9:16': 'Vertical', '16:9': 'Wide', '2:3': 'Pin' };

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className="glass-inner px-2.5 py-1 t-label" style={accent ? { color: '#b9e045', borderColor: 'rgba(185,224,69,0.35)' } : undefined}>{children}</span>;
}

function ScoreChip({ score }: { score: number }) {
  const good = score >= 0.62;
  return <span className="rounded-full px-2 py-0.5 t-label" style={{ background: good ? 'rgba(185,224,69,0.14)' : 'rgba(255,255,255,0.08)', color: good ? '#b9e045' : 'rgba(255,255,255,0.7)' }}>{Math.round(score * 100)}% match</span>;
}

/**
 * The client's social template library: each template is one of the client's
 * own posts, read into layers by the server and kept only when the re-render
 * reproduces it. Approving the library is what designs render from.
 */
export function DesignSystemPanel({ clientId, referenceCount }: { clientId?: string; referenceCount: number }) {
  const [build, setBuild] = useState<LibraryBuild | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [approved, setApproved] = useState<ClientDesignSystem | null>(null);
  const [stepping, setStepping] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(clientId); active.current = clientId;
  const running = useRef(false);

  const load = async () => {
    if (!clientId) { setBuild(null); setBuildId(null); setApproved(null); return; }
    setError('');
    try {
      const [b, systems] = await Promise.all([fetchLibraryBuild(clientId), fetchDesignSystems(clientId)]);
      if (active.current !== clientId) return;
      setBuild(b.build); setBuildId(b.id); setApproved(systems.find((s) => s.status === 'approved') || null);
      if (b.build && !b.build.done) void drive();
    } catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The template library could not be loaded.'); }
  };
  useEffect(() => { void load(); return () => { running.current = false; }; }, [clientId]);

  /** Step the build until it is done, one server call at a time; stops when the client changes or the page closes. */
  const drive = async () => {
    if (!clientId || running.current) return;
    running.current = true; setStepping(true);
    try {
      for (let i = 0; i < 60 && running.current && active.current === clientId; i++) {
        const r = await stepLibraryBuild(clientId);
        if (active.current !== clientId) break;
        setBuild(r.build); setBuildId(r.id);
        if (r.build.done) break;
      }
    } catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The template library could not be built.'); }
    finally { running.current = false; if (active.current === clientId) setStepping(false); }
  };

  const start = async () => {
    if (!clientId) return;
    setError('');
    try { const r = await startLibraryBuild(clientId); if (active.current !== clientId) return; setBuild(r.build); setBuildId(r.id); void drive(); }
    catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The template library could not be started.'); }
  };
  const approve = async () => {
    if (!clientId || !buildId) return;
    setApproving(true); setError('');
    try { await approveLibrary(clientId, buildId); await load(); }
    catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The library could not be approved.'); }
    finally { if (active.current === clientId) setApproving(false); }
  };

  const templates = build?.templates || [];
  const faces = build ? facesOf(build) : [];
  const buildIsApproved = !!approved && !!buildId && approved.id === buildId;
  const canStart = !!clientId && referenceCount >= 3 && !stepping;
  const progress = build?.progress;

  return <section className="glass p-5 space-y-4" aria-label="Design system">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5">
        <Palette className="h-4 w-4" style={{ color: '#b9e045' }} />
        <h3 className="t-h3">Social templates</h3>
        {approved && <span className="rounded-full px-2.5 py-0.5 t-badge" style={{ background: 'rgba(185,224,69,0.14)', color: '#b9e045' }}>Approved</span>}
        {build && !build.done && <span className="rounded-full px-2.5 py-0.5 t-badge bg-white/10 text-foreground/90">Reading posts</span>}
        {build?.done && !buildIsApproved && <span className="rounded-full px-2.5 py-0.5 t-badge bg-white/10 text-foreground/90">Ready to approve</span>}
      </div>
      <div className="flex items-center gap-2">
        {build?.done && !buildIsApproved && templates.length > 0 && <Button size="sm" disabled={approving} onClick={approve}>
          {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Approve {templates.length} templates
        </Button>}
        <Button variant="outline" size="sm" disabled={!canStart} onClick={start}>
          {stepping ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {build ? 'Read posts again' : 'Build from posts'}
        </Button>
      </div>
    </div>

    {!clientId && <p className="t-secondary text-muted-foreground">Save the client and connect its social accounts first.</p>}
    {clientId && !build && <p className="t-secondary text-muted-foreground">{referenceCount >= 3 ? 'Each of this client’s published posts is read into a layout and kept only when the server can reproduce it. Approving the set turns designs on for the client.' : 'At least three branded posts are needed. They appear above once the social accounts are connected.'}</p>}
    {build && !build.done && <p role="status" className="t-secondary text-muted-foreground">
      {progress ? `${progress.kept} kept, ${progress.remaining} to go` : 'Reading posts'}{progress?.current ? ` · current post round ${progress.current.round + 1}, ${Math.round(progress.current.score * 100)}% match` : ''}. About a minute per post.
    </p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    {build && (faces.length > 0 || build.logo_url) && <div className="flex flex-wrap items-center gap-2">
      {build.logo_url && <div className="flex items-center justify-center rounded-lg px-3 py-2 bg-black/40" style={{ minWidth: 96 }}><img src={build.logo_url} alt="Client logo asset" className="h-6 object-contain" /></div>}
      {faces.map((f, i) => <Chip key={f} accent={i === 0}>{f}</Chip>)}
      {build.rejected.length > 0 && <Chip>{build.rejected.length} post{build.rejected.length > 1 ? 's' : ''} could not be reproduced</Chip>}
    </div>}

    {templates.length > 0 && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {templates.map((t) => <figure key={t.id} className="glass-inner p-2 space-y-1.5">
        <div className="grid grid-cols-2 gap-1.5">
          <img src={postUrl(t.source_path)} alt={`${t.name}: the client’s post`} className="w-full rounded-md object-contain bg-black/40" style={{ aspectRatio: `${t.width} / ${t.height}` }} />
          {t.preview_url ? <img src={t.preview_url} alt={`${t.name}: the template as rendered`} className="w-full rounded-md object-contain bg-black/40" style={{ aspectRatio: `${t.width} / ${t.height}` }} /> : <div className="w-full rounded-md bg-black/40" style={{ aspectRatio: `${t.width} / ${t.height}` }} />}
        </div>
        <figcaption className="flex items-center justify-between gap-2">
          <span className="t-label truncate">{t.name} · {t.slots.map((s) => s.role).join(', ')}</span>
          <span className="flex items-center gap-1.5 shrink-0"><span className="t-label text-muted-foreground">{FORMAT_LABEL[t.format] || t.format}</span><ScoreChip score={t.score} /></span>
        </figcaption>
      </figure>)}
    </div>}
  </section>;
}
