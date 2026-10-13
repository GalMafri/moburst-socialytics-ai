/**
 * What every design for a client is built from, confirmed once by Moburst
 * staff (Lital's decision, 12 Oct 2026): the logo file, where the client puts
 * it, the background behind it, and three of the client's own posts whose
 * look the designs follow. Until these are confirmed, nobody is offered
 * "Create designs" for this client.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Anchor = "left" | "center" | "right";
type Spot = `${"top" | "bottom"}-${Anchor}`;
interface Placement { anchor: Anchor; width: number; top: number; left?: number }

const SPOTS: Array<{ value: Spot; label: string }> = [
  { value: "top-left", label: "Top left" },
  { value: "top-center", label: "Top center" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-center", label: "Bottom center" },
  { value: "bottom-right", label: "Bottom right" },
];
const FRAME = { w: 1088, h: 1360 };
const MAX_REFS = 3;
const HEX = /^#[0-9a-f]{6}$/i;

/** A placement from the spot, size and edge distance chosen here. */
function toPlacement(spot: Spot, widthPct: number, edgePct: number, logoAspect: number): Placement {
  const [v, anchor] = spot.split("-") as ["top" | "bottom", Anchor];
  const width = widthPct / 100;
  const heightShare = (width * FRAME.w) / logoAspect / FRAME.h;
  const edge = edgePct / 100;
  const top = v === "top" ? edge : Math.max(0, 1 - edge - heightShare);
  return anchor === "center" ? { anchor, width, top } : { anchor, width, top, left: edge * (FRAME.h / FRAME.w) };
}

/** The controls' values back from a stored placement. */
function fromPlacement(p: Placement, logoAspect: number): { spot: Spot; widthPct: number; edgePct: number } {
  const heightShare = (p.width * FRAME.w) / logoAspect / FRAME.h;
  const bottom = p.top > 0.5;
  return {
    spot: `${bottom ? "bottom" : "top"}-${p.anchor}` as Spot,
    widthPct: Math.round(p.width * 1000) / 10,
    edgePct: Math.round((bottom ? 1 - p.top - heightShare : p.top) * 1000) / 10,
  };
}

export function DesignSettingsCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["design-settings-full", clientId],
    queryFn: async () => {
      const [{ data: settings, error: sErr }, { data: client, error: cErr }] = await Promise.all([
        (supabase.from("design_brand_settings" as any) as any).select("*").eq("client_id", clientId).maybeSingle(),
        supabase.from("clients").select("design_references, harvested_design_references").eq("id", clientId).maybeSingle(),
      ]);
      if (sErr) throw sErr;
      if (cErr) throw cErr;
      const own = ((client as any)?.design_references as string[] | null) || [];
      const harvested = (((client as any)?.harvested_design_references as Array<{ path?: string }> | null) || []).map((r) => r.path).filter(Boolean) as string[];
      const paths = [...new Set([...own, ...harvested])];
      const { data: signed } = paths.length ? await supabase.storage.from("design-references").createSignedUrls(paths, 3600) : { data: [] as any[] };
      const previews = Object.fromEntries((signed || []).filter((r: any) => r.signedUrl).map((r: any) => [r.path, r.signedUrl]));
      return { settings: settings as any, paths, previews: previews as Record<string, string> };
    },
  });

  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoAspect, setLogoAspect] = useState(3);
  const [spot, setSpot] = useState<Spot>("top-center");
  const [widthPct, setWidthPct] = useState(25);
  const [edgePct, setEdgePct] = useState(4);
  const [background, setBackground] = useState("#0B0E1A");
  const [refs, setRefs] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoDesigns, setAutoDesigns] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);

  const logoUrl = useMemo(() => (logoPath ? supabase.storage.from("generated-media").getPublicUrl(logoPath).data.publicUrl : null), [logoPath]);

  // Load what is stored once the logo's proportions are known (they turn a
  // stored placement back into the spot, size and edge distance shown here).
  useEffect(() => {
    const s = data?.settings;
    if (!s) return;
    setLogoPath(s.logo_path);
    setBackground(s.background);
    setRefs(s.reference_paths || []);
    setAutoDesigns(!!s.auto_designs);
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      setLogoAspect(aspect);
      const c = fromPlacement(s.placement, aspect);
      setSpot(c.spot); setWidthPct(c.widthPct); setEdgePct(c.edgePct);
    };
    img.src = supabase.storage.from("generated-media").getPublicUrl(s.logo_path).data.publicUrl;
  }, [data?.settings]);

  const uploadLogo = async (file: File) => {
    if (file.type !== "image/png") { toast.error("Use a PNG logo with a transparent background."); return; }
    setUploading(true);
    try {
      const path = `${clientId}/design-settings/logo-${Date.now()}.png`;
      const { error } = await supabase.storage.from("generated-media").upload(path, file, { contentType: "image/png" });
      if (error) throw error;
      const img = new Image();
      img.onload = () => setLogoAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
      img.src = URL.createObjectURL(file);
      setLogoPath(path);
    } catch (e) {
      toast.error("Could not upload the logo", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setUploading(false);
    }
  };

  const toggleRef = (path: string) => {
    setRefs((cur) => (cur.includes(path) ? cur.filter((p) => p !== path) : cur.length >= MAX_REFS ? cur : [...cur, path]));
  };

  const placement = toPlacement(spot, widthPct, edgePct, logoAspect);
  const ready = !!logoPath && HEX.test(background) && refs.length >= 1;

  const confirm = async () => {
    if (!ready) return;
    setSaving(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await (supabase.from("design_brand_settings" as any) as any).upsert({
        client_id: clientId,
        logo_path: logoPath,
        placement,
        background: background.toUpperCase(),
        reference_paths: refs,
        confirmed_at: new Date().toISOString(),
        confirmed_by: auth?.user?.id ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "client_id" });
      if (error) throw error;
      toast.success("Design settings confirmed");
      void qc.invalidateQueries({ queryKey: ["design-settings-full", clientId] });
      void qc.invalidateQueries({ queryKey: ["design-settings", clientId] });
    } catch (e) {
      toast.error("Could not save the design settings", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setSaving(false);
    }
  };

  const setAuto = async (on: boolean) => {
    setSavingAuto(true);
    setAutoDesigns(on);
    try {
      const { error } = await (supabase.from("design_brand_settings" as any) as any).update({ auto_designs: on, updated_at: new Date().toISOString() }).eq("client_id", clientId);
      if (error) throw error;
      toast.success(on ? "Designs will be prepared automatically" : "Automatic designs are off");
      void qc.invalidateQueries({ queryKey: ["design-settings-full", clientId] });
    } catch (e) {
      setAutoDesigns(!on);
      toast.error("Could not change that", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setSavingAuto(false);
    }
  };

  if (isLoading) return <Card><CardContent className="p-6"><Loader2 className="h-4 w-4 animate-spin" /></CardContent></Card>;
  const confirmedAt = data?.settings?.confirmed_at ? new Date(data.settings.confirmed_at) : null;

  // Preview: the frame at 4:5 with the logo where designs will put it.
  const logoStyle: React.CSSProperties = {
    position: "absolute",
    width: `${placement.width * 100}%`,
    top: `${placement.top * 100}%`,
    ...(placement.anchor === "center" ? { left: `${((1 - placement.width) / 2) * 100}%` } : placement.anchor === "left" ? { left: `${(placement.left ?? 0) * 100}%` } : { right: `${(placement.left ?? 0) * 100}%` }),
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="t-h3">Design settings</CardTitle>
        <CardDescription>
          Every design for this client is built from these. Confirm them once; your team and the client can then create designs from any post.
          {confirmedAt && <span className="block mt-1 text-[#b9e045]">Confirmed {confirmedAt.toLocaleDateString()}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="design-logo">Logo file</Label>
            <div className="flex items-center gap-3">
              <div className="h-14 w-40 rounded-[10px] flex items-center justify-center p-2" style={{ background }}>
                {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="t-label">No logo yet</span>}
              </div>
              <Button asChild variant="outline" size="sm" disabled={uploading}>
                <label htmlFor="design-logo" className="cursor-pointer">
                  {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ImageUp className="h-3.5 w-3.5 mr-1.5" />}
                  {logoPath ? "Replace" : "Upload PNG"}
                </label>
              </Button>
              <input id="design-logo" type="file" accept="image/png" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = ""; }} />
            </div>
            <p className="t-label">The exact file placed on every design. Use the version that reads on the background below.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="design-spot">Logo position</Label>
              <Select value={spot} onValueChange={(v) => setSpot(v as Spot)}>
                <SelectTrigger id="design-spot"><SelectValue /></SelectTrigger>
                <SelectContent>{SPOTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-width">Logo width · {widthPct.toFixed(0)}%</Label>
              <Slider id="design-width" min={10} max={45} step={0.5} value={[widthPct]} onValueChange={([v]) => setWidthPct(v)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-edge">Distance from edge · {edgePct.toFixed(1)}%</Label>
              <Slider id="design-edge" min={1} max={12} step={0.1} value={[edgePct]} onValueChange={([v]) => setEdgePct(v)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="design-bg">Background behind the logo</Label>
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick a background color" value={HEX.test(background) ? background : "#000000"} onChange={(e) => setBackground(e.target.value.toUpperCase())} className="h-9 w-12 rounded-[8px] bg-transparent border border-white/10" />
              <Input id="design-bg" value={background} onChange={(e) => setBackground(e.target.value)} className="w-32" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>The client's posts to follow · {refs.length} of {MAX_REFS}</Label>
            <p className="t-label">Pick posts that show the look you want, without the client's logo printed on objects in the picture.</p>
            {data?.paths.length ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {data.paths.map((p) => {
                  const on = refs.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => toggleRef(p)} aria-pressed={on} aria-label={on ? "Remove this post" : "Use this post"}
                      className={`relative aspect-square rounded-[10px] overflow-hidden border ${on ? "border-primary ring-1 ring-primary/50" : "border-white/10"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                      {data.previews[p] ? <img src={data.previews[p]} alt="" className="w-full h-full object-cover" /> : <span className="t-label">Unavailable</span>}
                      {on && <span className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1"><Check className="h-3 w-3" /></span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="t-secondary">This client has no reference posts yet. Add some in the Brief tab.</p>
            )}
          </div>

          {confirmedAt && (
            <div className="glass-inner p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="design-auto" className="text-sm font-semibold text-white">Prepare designs automatically</Label>
                <p className="t-secondary">Each post in the calendar gets its design during the week before its date, from its copy at the time. Every design uses the team's Canva and image allowances.</p>
              </div>
              <Switch id="design-auto" checked={autoDesigns} disabled={savingAuto} onCheckedChange={(v) => void setAuto(v)} />
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={confirm} disabled={!ready || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Check className="h-3.5 w-3.5 mr-1.5" />}
              {confirmedAt ? "Confirm changes" : "Confirm design settings"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <p className="t-label">Where the logo goes</p>
          <div className="relative w-full aspect-[4/5] rounded-[12px] overflow-hidden border border-white/10" style={{ background: HEX.test(background) ? background : "#000" }}>
            {logoUrl && <img src={logoUrl} alt="" style={logoStyle} />}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
