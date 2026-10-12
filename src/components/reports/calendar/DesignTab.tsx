// The Design tab of a calendar post: create designs for this post, follow the run, see the
// options that passed every check, use one. Wording is the client's: "Create designs",
// "Your options", "Checks passed", "Use this one". Nothing about models, prompts or scores.
//
// Spec: docs/superpowers/specs/2026-10-08-design-engine-design.md, section 13.

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// The design tables arrive with migration 20261012100000_design_runs.sql; the generated
// types are refreshed once it is applied. Until then the client is used untyped here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as SupabaseClient<any>;
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export interface DesignTabPost {
  _calendarPostKey?: string;
  platform?: string | null;
  format?: string | null;
  copy?: string | null;
  content?: string | null;
  pillar?: string | null;
  content_pillar?: string | null;
}

interface DesignRunRow {
  id: string;
  status: "queued" | "running" | "offered" | "picked" | "failed" | "dropped";
  sizes: Array<{ name: string; w: number; h: number }> | null;
  plan: { stage?: string } | null;
  failure: string | null;
  created_at: string;
}

interface DesignOptionRow {
  id: string;
  option_key: string;
  rank: number | null;
  kind: "static" | "carousel" | "slide";
  parent_key: string | null;
  slide_role: string | null;
  files: Record<string, { url?: string; w?: number; h?: number; passed?: boolean }>;
  status: "offered" | "picked" | "rejected";
}

interface Props {
  post: DesignTabPost;
  clientId?: string;
  reportId?: string;
  onPicked?: () => void;
}

const POLL_MS = 10_000;

export function DesignTab({ post, clientId, reportId, onPicked }: Props) {
  const postKey = post._calendarPostKey;
  const [run, setRun] = useState<DesignRunRow | null>(null);
  const [options, setOptions] = useState<DesignOptionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = async () => {
    if (!clientId || !postKey) return;
    const { data: runs } = await db.from("design_runs").select("id, status, sizes, plan, failure, created_at")
      .eq("client_id", clientId).eq("post_key", postKey).order("created_at", { ascending: false }).limit(1);
    const latest = (runs?.[0] as DesignRunRow | undefined) || null;
    setRun(latest);
    if (latest && (latest.status === "offered" || latest.status === "picked")) {
      const { data: opts } = await db.from("design_options").select("id, option_key, rank, kind, parent_key, slide_role, files, status")
        .eq("run_id", latest.id).order("rank", { ascending: true, nullsFirst: false }).order("option_key");
      setOptions((opts as DesignOptionRow[]) || []);
    } else {
      setOptions([]);
    }
  };

  useEffect(() => { void load(); }, [clientId, postKey]);
  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;
    const t = setInterval(() => { void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [run?.id, run?.status]);

  const create = async () => {
    if (!clientId || !postKey) return;
    setBusy(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const copy = post.copy || post.content || "";
      const { error } = await db.from("design_runs").insert({
        client_id: clientId, post_key: postKey, report_id: reportId || null, platform: post.platform || "Instagram",
        format: post.format || "Single Image", copy, pillar: post.pillar || post.content_pillar || null,
        created_by: userData?.user?.id || null,
      });
      if (error) throw error;
      toast.success("Designs are on their way. This takes a few minutes; you can close this panel.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the designs.");
    } finally {
      setBusy(false);
    }
  };

  const pick = async (optionId: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("design-pick", { body: { option_id: optionId, action: "pick" } });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Could not use this design.");
      toast.success("Added to this post. Schedule it from the Schedule tab.");
      await load();
      onPicked?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not use this design.");
    } finally {
      setBusy(false);
    }
  };

  const reject = async (optionId: string) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("design-pick", { body: { option_id: optionId, action: "reject", note: note.trim() || null } });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Could not record that.");
      setRejecting(null);
      setNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  const tops = useMemo(() => options.filter((o) => o.kind !== "slide"), [options]);
  const slidesOf = (key: string) => options.filter((o) => o.kind === "slide" && o.parent_key === key);
  const primary = run?.sizes?.[0]?.name;
  const inProgress = run?.status === "queued" || run?.status === "running";

  if (!clientId || !postKey) {
    return <p className="t-secondary">Open this post from its calendar to create designs.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {inProgress ? "Creating your designs" : tops.length ? "Your options" : "No designs yet"}
          </p>
          <p className="t-secondary">
            {inProgress
              ? "Every option is checked against your brand before you see it. A few minutes."
              : tops.length
                ? "Each option passed every check. Use one to attach it to this post."
                : "Designs are made from your brand: your logo, your fonts, your layouts."}
          </p>
        </div>
        <Button size="sm" onClick={create} disabled={busy || inProgress}>
          {inProgress ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          <span className="ml-1.5">{tops.length ? "Create more" : "Create designs"}</span>
        </Button>
      </div>

      {run?.status === "failed" || run?.status === "dropped" ? (
        <div className="glass-inner p-4">
          <p className="t-body">We could not make a design that meets your brand's standards for this post.</p>
          <p className="t-secondary mt-1">Try again, or shorten the post copy.</p>
        </div>
      ) : null}

      {tops.map((o) => {
        const slides = o.kind === "carousel" ? slidesOf(o.option_key) : [];
        const files = o.kind === "carousel" ? [] : Object.entries(o.files || {});
        return (
          <div key={o.id} className="glass-inner p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold">Option {o.option_key}</p>
                <Badge variant="secondary" className="gap-1"><Check className="h-3 w-3" /> Checks passed</Badge>
                {o.status === "picked" && <Badge>In use</Badge>}
                {o.status === "rejected" && <Badge variant="outline">Not this one</Badge>}
              </div>
              {o.status === "offered" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setRejecting(rejecting === o.id ? null : o.id)}>Not this one</Button>
                  <Button size="sm" disabled={busy} onClick={() => pick(o.id)}>Use this one</Button>
                </div>
              )}
            </div>
            {o.kind === "carousel" ? (
              <div className="flex gap-2 overflow-x-auto">
                {slides.map((s) => {
                  const f = (primary && s.files?.[primary]) || Object.values(s.files || {})[0];
                  return f?.url ? <img key={s.id} src={f.url} alt={`Slide ${s.option_key.split(".").pop()}`} className="h-48 rounded-md shrink-0" /> : null;
                })}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {files.map(([size, f]) => f?.url ? (
                  <figure key={size} className="space-y-1">
                    <img src={f.url} alt={`Option ${o.option_key}, ${f.w}×${f.h}`} className="w-full rounded-md" />
                    <figcaption className="t-secondary">{f.w}×{f.h}</figcaption>
                  </figure>
                ) : null)}
              </div>
            )}
            {rejecting === o.id && (
              <div className="space-y-2">
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should we keep in mind next time? (optional)" rows={2} />
                <div className="flex gap-2 justify-end">
                  <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => reject(o.id)}>Send</Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
