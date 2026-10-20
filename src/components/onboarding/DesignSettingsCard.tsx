/**
 * What every design for a client is built from: the logo file, where the
 * client puts it, the background behind it, and the client's own posts whose
 * look the designs follow. The client lifecycle works these out on its own
 * (Lital's decision 2, 19 Oct 2026: the logo from the website, its place
 * from the client's posts, the background from the brand colors) and they
 * are in place from then on. A person may change any of them here; the
 * lifecycle never replaces settings a person saved.
 *
 * There is no switch for automatic designs: they stay off for good (Lital,
 * 20 Oct 2026). Designs are made only when a person asks for one on a post.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/display";
import { Loading } from "@/components/ui/loading";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { fileKey, useQuietUpload } from "@/hooks/useQuietUpload";

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
/** Most of the client's posts designs are built from (the planner is shown them all). */
const MAX_REFS = 16;
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

/** Any image as a PNG: designs place a PNG, so a JPG or WebP logo is turned into one here. */
async function asPng(file: File): Promise<File> {
  if (file.type === "image/png") return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png", lastModified: file.lastModified }) : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DERIVED_WORDS = {
  placement: { client_posts: "where the client's own posts put it", default: "the standard place at the top" } as Record<string, string>,
  background: { brand_color: "a brand color", neutral: "a neutral color that suits the logo" } as Record<string, string>,
};

/** Where the stored settings came from, as a sentence. */
function originSentence(settings: { source?: string; derived?: Record<string, unknown> | null; confirmed_at?: string | null; updated_at?: string | null } | null): string {
  if (!settings) return "";
  if (settings.source === "lifecycle") {
    const d = settings.derived ?? {};
    const on = formatDate(String(d.at ?? settings.confirmed_at ?? ""));
    const place = DERIVED_WORDS.placement[String(d.placement_from ?? "")];
    const bg = DERIVED_WORDS.background[String(d.background_from ?? "")];
    const parts = ["the logo from the client's website", place ? `its place from ${place}` : "", bg ? `the background from ${bg}` : ""].filter(Boolean);
    return `Worked out automatically${on ? ` on ${on}` : ""}: ${parts.join(", ")}. You can change any of them here.`;
  }
  const on = formatDate(settings.updated_at ?? settings.confirmed_at ?? "");
  return `Set by your team${on ? ` on ${on}` : ""}. The product keeps these as they are.`;
}

export function DesignSettingsCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["design-settings-full", clientId],
    queryFn: async () => {
      const [{ data: settings, error: sErr }, { data: client, error: cErr }] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from("design_brand_settings" as any) as any).select("*").eq("client_id", clientId).maybeSingle(),
        supabase.from("clients").select("design_references, harvested_design_references").eq("id", clientId).maybeSingle(),
      ]);
      if (sErr) throw sErr;
      if (cErr) throw cErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const own = ((client as any)?.design_references as string[] | null) || [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const harvested = (((client as any)?.harvested_design_references as Array<{ path?: string }> | null) || []).map((r) => r.path).filter(Boolean) as string[];
      const paths = [...new Set([...own, ...harvested])];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: signed } = paths.length ? await supabase.storage.from("design-references").createSignedUrls(paths, 3600) : { data: [] as any[] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const previews = Object.fromEntries((signed || []).filter((r: any) => r.signedUrl).map((r: any) => [r.path, r.signedUrl]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  const [saving, setSaving] = useState(false);
  const [notSaved, setNotSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refusedLogo, setRefusedLogo] = useState<string | null>(null);

  const logoUrl = useMemo(() => (logoPath ? supabase.storage.from("generated-media").getPublicUrl(logoPath).data.publicUrl : null), [logoPath]);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true); setNotSaved(false); };

  // What is stored, once the logo's proportions are known (they turn a stored
  // placement back into the spot, size and edge distance shown here).
  useEffect(() => {
    const s = data?.settings;
    if (!s || dirty) return;
    setLogoPath(s.logo_path);
    setBackground(s.background);
    setRefs(s.reference_paths?.length ? s.reference_paths : []);
    const img = new Image();
    img.onload = () => {
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
      setLogoAspect(aspect);
      const c = fromPlacement(s.placement, aspect);
      setSpot(c.spot); setWidthPct(c.widthPct); setEdgePct(c.edgePct);
    };
    img.src = supabase.storage.from("generated-media").getPublicUrl(s.logo_path).data.publicUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.settings]);

  // Before anything is stored, every post the client has is in.
  useEffect(() => {
    if (data && !data.settings && data.paths.length && !dirty) setRefs(data.paths.slice(0, MAX_REFS));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const pathFor = (file: File) => `${clientId}/design-settings/logo-${fileKey(file).replace(/\.[^.]+$/, "")}.png`;
  const uploadLogo = useCallback(async (file: File) => {
    const png = await asPng(file);
    return supabase.storage.from("generated-media").upload(pathFor(file), png, { contentType: "image/png", upsert: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const logoUploaded = useCallback((file: File) => {
    const img = new Image();
    img.onload = () => setLogoAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.src = URL.createObjectURL(file);
    setLogoPath(pathFor(file));
    setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const logo = useQuietUpload(uploadLogo, logoUploaded);

  const chooseLogo = (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setRefusedLogo(file.name); return; }
    setRefusedLogo(null);
    void logo.send(file);
  };

  const toggleRef = (path: string) => {
    edit(setRefs)(refs.includes(path) ? refs.filter((p) => p !== path) : refs.length >= MAX_REFS ? refs : [...refs, path]);
  };

  const placement = toPlacement(spot, widthPct, edgePct, logoAspect);
  const complete = !!logoPath && HEX.test(background) && refs.length >= 1;

  // A person's save: from then on these are theirs (source 'person', by trigger), and the lifecycle leaves them alone.
  const save = async () => {
    if (!complete) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.from("design_brand_settings" as any) as any).upsert({
      client_id: clientId,
      logo_path: logoPath,
      placement,
      background: background.toUpperCase(),
      reference_paths: refs,
      confirmed_at: new Date().toISOString(),
      confirmed_by: auth?.user?.id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "client_id" }), { again: writeResendable });
    setSaving(false);
    if (error) { setNotSaved(true); return; }
    setDirty(false);
    toast.success("Design settings saved");
    void qc.invalidateQueries({ queryKey: ["design-settings-full", clientId] });
    void qc.invalidateQueries({ queryKey: ["design-settings", clientId] });
  };

  if (isLoading) return <Card><CardContent><Loading label="Loading design settings" /></CardContent></Card>;
  const origin = originSentence(data?.settings ?? null);

  // Preview: the frame at 4:5 with the logo where designs will put it.
  const logoStyle: React.CSSProperties = {
    position: "absolute",
    width: `${placement.width * 100}%`,
    top: `${placement.top * 100}%`,
    ...(placement.anchor === "center" ? { left: `${((1 - placement.width) / 2) * 100}%` } : placement.anchor === "left" ? { left: `${(placement.left ?? 0) * 100}%` } : { right: `${(placement.left ?? 0) * 100}%` }),
  };

  return (
    <Section
      layout="split"
      eyebrow="Designs"
      title="Design settings"
      description={
        <>
          Every design for this client is built from these. Designs are made only when someone asks for one on a post.
          <span className="block mt-2 t-label">{origin || "They are worked out automatically from the client's logo and its own posts once those are read."}</span>
        </>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[1fr_220px]">
        <div className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="design-logo">Logo file</Label>
            <div className="flex items-center gap-3">
              <div className="h-14 w-40 rounded-[12px] flex items-center justify-center p-2" style={{ background }}>
                {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="t-label">No logo yet</span>}
              </div>
              <Button asChild variant="outline" size="sm" disabled={logo.uploading}>
                <label htmlFor="design-logo" className="cursor-pointer">
                  {logo.uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
                  {logoPath ? "Replace" : "Upload logo"}
                </label>
              </Button>
              <input id="design-logo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseLogo(f); e.target.value = ""; }} />
            </div>
            <p className="t-label">The exact file placed on every design, best as a PNG with a transparent background.</p>
            {refusedLogo && <p className="t-secondary" role="status">{refusedLogo} is not a PNG, JPG or WebP image, so the current logo stays.</p>}
            {logo.pending && !logo.uploading && (
              <div className="flex items-center gap-2" role="status">
                <span className="t-secondary truncate">{logo.pending.name} is not uploaded yet.</span>
                <Button variant="outline" size="sm" onClick={() => void logo.again()}>Upload</Button>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="design-spot">Logo position</Label>
              <Select value={spot} onValueChange={(v) => edit(setSpot)(v as Spot)}>
                <SelectTrigger id="design-spot"><SelectValue /></SelectTrigger>
                <SelectContent>{SPOTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-width">Logo width · {widthPct.toFixed(0)}%</Label>
              <Slider id="design-width" min={10} max={45} step={0.5} value={[widthPct]} onValueChange={([v]) => edit(setWidthPct)(v)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="design-edge">Distance from edge · {edgePct.toFixed(1)}%</Label>
              <Slider id="design-edge" min={1} max={12} step={0.1} value={[edgePct]} onValueChange={([v]) => edit(setEdgePct)(v)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="design-bg">Background behind the logo</Label>
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick a background color" value={HEX.test(background) ? background : "#000000"} onChange={(e) => edit(setBackground)(e.target.value.toUpperCase())} className="h-9 w-12 rounded-[8px] bg-transparent border border-white/10" />
              <Input id="design-bg" value={background} onChange={(e) => edit(setBackground)(e.target.value)} className="w-32" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label>The client's posts designs are built from · {refs.length} of {Math.min(MAX_REFS, data?.paths.length ?? 0)}</Label>
              {data && data.paths.length > 0 && refs.length < Math.min(MAX_REFS, data.paths.length) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => edit(setRefs)(data.paths.slice(0, MAX_REFS))}>Use all</Button>
              )}
            </div>
            <p className="t-label">Each design builds on the one or two of these whose layout suits what its post says, and on different ones than the designs before it.</p>
            {data?.paths.length ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {data.paths.map((p) => {
                  const on = refs.includes(p);
                  return (
                    <button key={p} type="button" onClick={() => toggleRef(p)} aria-pressed={on} aria-label={on ? "Leave this post out" : "Use this post"}
                      className={`relative aspect-square rounded-[12px] overflow-hidden border ${on ? "border-primary ring-1 ring-primary/50" : "border-white/10"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
                      {data.previews[p] ? <img src={data.previews[p]} alt="" className="w-full h-full object-cover" /> : <span className="t-label">Preview not available</span>}
                      {on && <span className="absolute top-1.5 right-1.5 bg-primary text-primary-foreground rounded-full p-1"><Check className="h-3 w-3" /></span>}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="t-secondary">The client's own posts appear here once they are read from its accounts.</p>
            )}
          </div>

          {(dirty || !data?.settings) && (
            <div className="flex flex-wrap items-center gap-3">
              {notSaved && <span role="status" className="t-secondary">Your changes are kept here and are not saved yet.</span>}
              <Button onClick={() => void save()} disabled={!complete || saving || logo.uploading}>
                {saving ? <Loader2 className="animate-spin" /> : <Check />}
                Save changes
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="t-label">Where the logo goes</p>
          <div className="relative w-full aspect-[4/5] rounded-[12px] overflow-hidden border border-white/10" style={{ background: HEX.test(background) ? background : "#000" }}>
            {logoUrl && <img src={logoUrl} alt="" style={logoStyle} />}
          </div>
        </div>
      </div>
    </Section>
  );
}
