import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Palette, RefreshCw, CheckCircle2 } from 'lucide-react';
import { approveDesignSystem, buildDesignSystem, currentSystems, fetchDesignSystems, type ClientDesignSystem } from '@/lib/designSystem';

const FORMAT_LABEL: Record<string, string> = { '4:5': 'Feed 4:5', '1:1': 'Square', '9:16': 'Vertical', '16:9': 'Wide', '2:3': 'Pin' };

function Swatch({ hex, label }: { hex: string; label: string }) {
  return <div className="flex items-center gap-2 glass-inner px-2.5 py-1.5" title={hex}>
    <span className="h-5 w-5 rounded-full border border-white/15" style={{ background: hex }} />
    <span className="t-label text-muted-foreground">{label}</span>
  </div>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="glass-inner px-2.5 py-1 t-label text-foreground/90">{children}</span>;
}

function StatusBadge({ status }: { status: ClientDesignSystem['status'] | 'none' }) {
  if (status === 'approved') return <span className="rounded-full px-2.5 py-0.5 t-badge" style={{ background: 'rgba(185,224,69,0.14)', color: '#b9e045' }}>Approved</span>;
  if (status === 'draft') return <span className="rounded-full px-2.5 py-0.5 t-badge bg-white/10 text-foreground/90">Draft</span>;
  return <span className="rounded-full px-2.5 py-0.5 t-badge bg-white/10 text-muted-foreground">Not built</span>;
}

/**
 * The client's design system: tokens read from its own posts, the layouts
 * it uses, and a preview of each. Approving it is what turns designs on
 * for the client; every design is then rendered from it on the server.
 */
export function DesignSystemPanel({ clientId, referenceCount }: { clientId?: string; referenceCount: number }) {
  const [systems, setSystems] = useState<ClientDesignSystem[]>([]);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(clientId); active.current = clientId;

  const load = async () => {
    if (!clientId) { setSystems([]); return; }
    setLoading(true); setError('');
    try { const rows = await fetchDesignSystems(clientId); if (active.current === clientId) setSystems(rows); }
    catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The design system could not be loaded.'); }
    finally { if (active.current === clientId) setLoading(false); }
  };
  useEffect(() => { void load(); }, [clientId]);

  const build = async () => {
    if (!clientId) return;
    setBuilding(true); setError('');
    try { const built = await buildDesignSystem(clientId); if (active.current === clientId) setSystems((s) => [built, ...s]); }
    catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The design system could not be built.'); }
    finally { if (active.current === clientId) setBuilding(false); }
  };
  const approve = async (id: string) => {
    if (!clientId) return;
    setApproving(true); setError('');
    try { await approveDesignSystem(clientId, id); await load(); }
    catch (e) { if (active.current === clientId) setError(e instanceof Error ? e.message : 'The design system could not be approved.'); }
    finally { if (active.current === clientId) setApproving(false); }
  };

  const { approved, draft } = currentSystems(systems);
  const shown = draft || approved;
  const canBuild = !!clientId && referenceCount >= 3 && !building;

  return <section className="glass p-5 space-y-4" aria-label="Design system">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2.5">
        <Palette className="h-4 w-4" style={{ color: '#b9e045' }} />
        <h3 className="t-h3">Design system</h3>
        <StatusBadge status={shown ? shown.status : 'none'} />
        {shown && <span className="t-label text-muted-foreground">v{shown.version}</span>}
      </div>
      <div className="flex items-center gap-2">
        {draft && <Button size="sm" disabled={approving} onClick={() => approve(draft.id)}>
          {approving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Approve v{draft.version}
        </Button>}
        <Button variant="outline" size="sm" disabled={!canBuild} onClick={build}>
          {building ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {shown ? 'Rebuild from posts' : 'Build from posts'}
        </Button>
      </div>
    </div>

    {!clientId && <p className="t-secondary text-muted-foreground">Save the client and connect its social accounts first.</p>}
    {clientId && !shown && !building && !loading && <p className="t-secondary text-muted-foreground">{referenceCount >= 3 ? 'Read the brand tokens and layouts from this client’s published posts. Approving the result turns designs on for the client.' : 'At least three branded posts are needed. They appear above once the social accounts are connected.'}</p>}
    {building && <p role="status" className="t-secondary text-muted-foreground">Reading tokens and layouts from {referenceCount} posts, cutting the logo and rendering a preview of every template. About a minute.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

    {shown && <>
      <div className="flex flex-wrap items-center gap-2">
        {shown.logo_url && <div className="flex items-center justify-center rounded-lg px-3 py-2" style={{ background: shown.system.tokens.colors.background, minWidth: 96 }}>
          <img src={shown.logo_url} alt="Client logo asset" className="h-6 object-contain" />
        </div>}
        <Swatch hex={shown.system.tokens.colors.background} label="Background" />
        <Swatch hex={shown.system.tokens.colors.surface} label="Surface" />
        <Swatch hex={shown.system.tokens.colors.ink} label="Ink" />
        <Swatch hex={shown.system.tokens.colors.accent} label="Accent" />
        {shown.system.tokens.colors.frame && shown.system.tokens.colors.frame.length >= 2 && <div className="flex items-center gap-2 glass-inner px-2.5 py-1.5">
          <span className="h-5 w-10 rounded-full border border-white/15" style={{ background: `linear-gradient(90deg, ${shown.system.tokens.colors.frame.join(', ')})` }} />
          <span className="t-label text-muted-foreground">Frame</span>
        </div>}
        <Chip>{shown.system.tokens.font.family}</Chip>
        <Chip>{shown.system.tokens.card.style === 'none' ? 'No card' : `${shown.system.tokens.card.style} card`}</Chip>
        <Chip>Logo {shown.system.tokens.logo.position.replace('-', ' ')}</Chip>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shown.system.templates.map((t) => {
          const preview = shown.previews.find((p) => p.template_id === t.id);
          return <figure key={t.id} className="glass-inner p-2 space-y-1.5">
            {preview ? <img src={preview.url} alt={`${t.name} preview`} className="w-full rounded-md object-contain bg-black/40" style={{ aspectRatio: '1 / 1' }} /> : <div className="w-full rounded-md bg-black/40" style={{ aspectRatio: '1 / 1' }} />}
            <figcaption className="flex items-center justify-between gap-2">
              <span className="t-label truncate">{t.name}</span>
              <span className="t-label text-muted-foreground shrink-0">{t.formats.map((f) => FORMAT_LABEL[f] || f).join(' · ')}</span>
            </figcaption>
          </figure>;
        })}
      </div>

      <details className="space-y-2">
        <summary className="cursor-pointer t-label text-muted-foreground">Imagery rule and notes</summary>
        <p className="t-secondary">{shown.system.imagery.style}</p>
        <p className="t-secondary text-muted-foreground">Subjects: {shown.system.imagery.subjects}</p>
        {shown.system.imagery.never.length > 0 && <p className="t-secondary text-muted-foreground">Never: {shown.system.imagery.never.join(', ')}</p>}
        {shown.system.notes && <p className="t-secondary text-muted-foreground">{shown.system.notes}</p>}
      </details>
      {draft && approved && <p className="t-label text-muted-foreground">Designs currently render from v{approved.version}. Approving v{draft.version} replaces it.</p>}
    </>}
  </section>;
}
