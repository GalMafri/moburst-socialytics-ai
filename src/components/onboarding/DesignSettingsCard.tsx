/**
 * What every design for a client is built from: the logo file, where the
 * client puts it and the background behind it. The client lifecycle works
 * these out on its own (Lital's decision 2, 19 Oct 2026: the logo from the
 * website, its place from the client's posts, the background from the brand
 * colors) and they are in place from then on. A person may change any of them
 * here; the lifecycle never replaces settings a person saved.
 *
 * Under the logo file the card shows the client's logo set once the
 * lifecycle has made it (16 Nov 2026): the logo for light and for dark
 * pictures and the logo in white, each only when a file serves it, with
 * where each file came from. No tile is ever empty, and nothing says how a
 * design is started. Each design carries the one its picture calls for. One
 * quiet control beside the tiles lets the team choose a file of their own
 * for the pictures the client's logo file was not made for, or take it out
 * again; that acts at once, is no part of Save, and leaves the settings
 * whose they are.
 *
 * The client's own posts the designs follow are not set here: they refresh
 * on their own every week, on every client's row, and staff keep or leave out
 * posts on the Brand references card (design: docs/superpowers/specs/
 * 2026-11-02-design-refs-refresh-design.md).
 *
 * There is no switch for automatic designs: they stay off for good (Lital,
 * 20 Oct 2026). Designs are made only when a person asks for one on a post.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { DEFAULT_DESIGN_BACKGROUND } from "@/lib/designReferences";
import { referencesFor } from "../../../supabase/functions/_shared/design-prompts/designRefs";
import { logoStorePlan } from "../../../supabase/functions/_shared/lifecycle/designSettings";
import { logoOtherPath, logoSetView } from "@/lib/logoSet";

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

/**
 * Any image as a PNG trimmed to its ink, its long side at most 1,200 pixels
 * (the same rule the lifecycle stores a logo by): designs place a PNG, and a
 * mark drawn on a big canvas with wide empty padding would otherwise be placed
 * at the canvas's width. A PNG that needs neither is kept as it is.
 */
async function asPng(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0);
    const plan = logoStorePlan(ctx.getImageData(0, 0, w, h).data, w, h, file.type === "image/png");
    if (!plan) return file;
    const out = document.createElement("canvas");
    const [ow, oh] = plan.size;
    out.width = ow;
    out.height = oh;
    const box = plan.box;
    out.getContext("2d")!.drawImage(canvas, box.x, box.y, box.width, box.height, 0, 0, ow, oh);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png", lastModified: file.lastModified }) : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DERIVED_WORDS = {
  placement: { client_posts: "where the client's own posts put it", logo_on_posts: "where the client's own posts put it", default: "the standard place at the top" } as Record<string, string>,
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
  return `Set by your team${on ? ` on ${on}` : ""}. Automatic updates leave these as they are.`;
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
      // The client's library as the lifecycle keeps it: a row made here before the lifecycle's starts with it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const paths = referencesFor((client as any)?.design_references, (client as any)?.harvested_design_references, MAX_REFS, null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { settings: settings as any, paths };
    },
  });

  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [logoAspect, setLogoAspect] = useState(3);
  const [spot, setSpot] = useState<Spot>("top-center");
  const [widthPct, setWidthPct] = useState(25);
  const [edgePct, setEdgePct] = useState(4);
  const [background, setBackground] = useState(DEFAULT_DESIGN_BACKGROUND);
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

  const pathFor = (file: File) => `${clientId}/design-settings/logo-${fileKey(file).replace(/\.[^.]+$/, "")}.png`;
  // The file as stored (trimmed): its proportions are the logo's.
  const stored = useRef<File | null>(null);
  const uploadLogo = useCallback(async (file: File) => {
    const png = await asPng(file);
    stored.current = png;
    return supabase.storage.from("generated-media").upload(pathFor(file), png, { contentType: "image/png", upsert: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  const logoUploaded = useCallback((file: File) => {
    const img = new Image();
    img.onload = () => setLogoAspect(img.naturalWidth / Math.max(1, img.naturalHeight));
    img.src = URL.createObjectURL(stored.current ?? file);
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

  // The client's logo set, once the lifecycle has made it. A person's own second file is put there or removed
  // through set_design_logo_other, which writes nothing else: the logo, placement and background stay whose they are.
  const { tiles, control } = useMemo(() => logoSetView(data?.settings ?? null), [data?.settings]);
  const [unnamed, setUnnamed] = useState<{ name: string; path: string } | null>(null);
  const [refusedOther, setRefusedOther] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  /** QA 22 Nov 2026: a Remove that did not get through says so; before, the file simply stayed with no word. */
  const [notRemoved, setNotRemoved] = useState(false);
  const nameOther = useCallback(async (name: string, path: string | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.rpc as any)("set_design_logo_other", { p_client: clientId, p_path: path }), { again: writeResendable });
    // Stored and not named yet: the file stays chosen, shown as not uploaded yet.
    setUnnamed(error && path ? { name, path } : null);
    if (!error) void qc.invalidateQueries({ queryKey: ["design-settings-full", clientId] });
    return !error;
  }, [clientId, qc]);
  const uploadOther = useCallback(async (file: File) => {
    const png = await asPng(file);
    return supabase.storage.from("generated-media").upload(logoOtherPath(clientId, fileKey(file)), png, { contentType: "image/png", upsert: true });
  }, [clientId]);
  const otherUploaded = useCallback((file: File) => { void nameOther(file.name, logoOtherPath(clientId, fileKey(file))); }, [clientId, nameOther]);
  const other = useQuietUpload(uploadOther, otherUploaded);
  const chooseOther = (file: File) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setRefusedOther(file.name); return; }
    setRefusedOther(null);
    setUnnamed(null);
    setNotRemoved(false);
    void other.send(file);
  };
  const removeOther = async () => {
    setRemoving(true);
    setNotRemoved(false);
    const removed = await nameOther("", null);
    setRemoving(false);
    setNotRemoved(!removed);
  };
  const otherWaiting = other.pending && !other.uploading ? other.pending.name : unnamed?.name ?? null;
  const publicUrl = (path: string) => supabase.storage.from("generated-media").getPublicUrl(path).data.publicUrl;

  const placement = toPlacement(spot, widthPct, edgePct, logoAspect);
  // A new row needs the client's posts; a stored one already has them, kept current by the lifecycle.
  const complete = !!logoPath && HEX.test(background) && (!!data?.settings || (data?.paths.length ?? 0) > 0);

  // A person's save: from then on the logo, placement and background are theirs (source 'person', by
  // trigger), and the lifecycle leaves them alone. The posts are not part of it: they keep refreshing.
  const save = async () => {
    if (!complete) return;
    setSaving(true);
    const { data: auth } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const fields = { logo_path: logoPath, placement, background: background.toUpperCase(), confirmed_at: now, confirmed_by: auth?.user?.id ?? null, updated_at: now };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const table = () => supabase.from("design_brand_settings" as any) as any;
    const { error } = await sendQuietly(() => data?.settings
      ? table().update(fields).eq("client_id", clientId)
      : table().upsert({ client_id: clientId, ...fields, reference_paths: (data?.paths ?? []).slice(0, MAX_REFS) }, { onConflict: "client_id" }), { again: writeResendable });
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
          <span className="block mt-2 t-label">The client's posts they follow refresh on their own, under Brand references from social posts.</span>
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
            <p className="t-label">The client's logo file, best as a PNG with a transparent background.</p>
            {refusedLogo && <p className="t-secondary" role="status">{refusedLogo} is not a PNG, JPG or WebP image, so the current logo stays.</p>}
            {logo.pending && !logo.uploading && (
              <div className="flex items-center gap-2" role="status">
                <span className="t-secondary truncate">{logo.pending.name} is not uploaded yet.</span>
                <Button variant="outline" size="sm" onClick={() => void logo.again()}>Upload</Button>
              </div>
            )}
          </div>

          {tiles.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-3">
                {tiles.map((t) => (
                  <div key={t.key} data-logo-tile={t.key} className="w-40 space-y-1.5">
                    <p className="t-label">{t.label}</p>
                    <div data-logo-ground className="h-14 w-40 rounded-[12px] flex items-center justify-center p-2 border border-white/10" style={{ background: t.ground }}>
                      <img src={publicUrl(t.path)} alt="" className="max-h-full max-w-full object-contain" />
                    </div>
                    <p className="t-label">{t.caption}</p>
                  </div>
                ))}
              </div>
              <p className="t-label">Each design carries the one its picture calls for.</p>
              {control && (
                <div className="flex flex-wrap items-center gap-x-5">
                  <Button asChild variant="link" size="sm" className="px-0" disabled={other.uploading}>
                    <label htmlFor="design-logo-other" className="cursor-pointer">
                      {other.uploading ? <Loader2 className="animate-spin" /> : <ImageUp />}
                      {control.label}
                    </label>
                  </Button>
                  {control.removable && <Button variant="link" size="sm" className="px-0" disabled={removing} onClick={() => void removeOther()}>{removing && <Loader2 className="animate-spin" aria-hidden />}Remove your team's file</Button>}
                </div>
              )}
              <input id="design-logo-other" aria-label="A second logo file" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) chooseOther(f); e.target.value = ""; }} />
              {notRemoved && <p className="t-secondary" role="status">Your team's file is not removed yet.</p>}
              {refusedOther && <p className="t-secondary" role="status">{refusedOther} is not a PNG, JPG or WebP image, so nothing changes.</p>}
              {otherWaiting && (
                <div className="flex items-center gap-2" role="status">
                  <span className="t-secondary truncate">{otherWaiting} is not uploaded yet.</span>
                  <Button variant="outline" size="sm" onClick={() => void (other.pending ? other.again() : unnamed ? nameOther(unnamed.name, unnamed.path) : null)}>Upload</Button>
                </div>
              )}
            </div>
          )}

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
