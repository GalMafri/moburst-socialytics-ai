/**
 * The client's own public profiles (spec: docs/superpowers/specs/2026-11-03-
 * strategy-v2-design.md, section 3): what its strategy reads where Sprout has
 * no account. Filled from data (RivalIQ's record of the company, the links on
 * its homepage), so nobody has to; a person may add or change one, and a
 * profile a person removes stays removed. Saves are sent again quietly.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformIcon } from "@/lib/platform-config";
import { platformName } from "@/lib/display";
import { sendQuietly, writeResendable } from "@/lib/quietSend";

const PLATFORMS = ["instagram", "tiktok", "facebook", "linkedin", "youtube", "x"];
const SOURCE: Record<string, string> = { rivaliq: "From RivalIQ", website: "From the website", person: "Added by the team" };

interface Row { platform: string; handle: string; url: string | null; source: string }

export function PublicProfiles({ clientId }: { clientId: string }) {
  const [platform, setPlatform] = useState("instagram");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const rows = useQuery({
    queryKey: ["client-public-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("client_public_profiles").select("platform, handle, url, source").eq("client_id", clientId);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const shown = (rows.data ?? []).filter((r) => r.source !== "removed").sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform));

  const run = async (what: string, send: () => PromiseLike<{ error: unknown }>) => {
    setBusy(what);
    setNotSaved(false);
    const { error } = await sendQuietly(send as never, { again: writeResendable });
    setBusy(null);
    if (error) {
      console.warn("[public profiles] not saved yet", error);
      setNotSaved(true);
      return false;
    }
    await rows.refetch();
    return true;
  };
  const add = async () => {
    const h = handle.trim().replace(/^@/, "");
    if (!h) return;
    const saved = await run("add", () => supabase.rpc("client_public_profile_set", { p_client: clientId, p_platform: platform, p_handle: h, p_url: "" }));
    if (saved) setHandle("");
  };

  if (rows.isLoading) return <Loading label="Loading the public profiles" />;
  if (rows.isError) return <LoadRetry context="public profiles" error={rows.error} onRetry={() => rows.refetch()} />;
  return (
    <div className="space-y-4">
      {shown.length > 0 ? (
        <ul className="glass-inner p-inner space-y-2">
          {shown.map((r) => (
            <li key={r.platform} className="flex flex-wrap items-center gap-2 min-w-0">
              <PlatformIcon platform={r.platform} className="h-4 w-4 shrink-0" />
              <span className="t-body">{platformName(r.platform)}</span>
              <span className="t-label truncate">@{r.handle}</span>
              <Badge variant="outline">{SOURCE[r.source] ?? ""}</Badge>
              <span className="ml-auto flex items-center gap-1">
                {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="t-link inline-flex items-center gap-1">Open <ExternalLink className="h-3 w-3" aria-hidden /></a>}
                <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Remove the ${platformName(r.platform)} profile`} disabled={!!busy}
                  onClick={() => void run(r.platform, () => supabase.rpc("client_public_profile_remove", { p_client: clientId, p_platform: r.platform }))}>
                  {busy === r.platform ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="t-secondary">None found yet. They are read from RivalIQ and the client's website within a day.</p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="public-profile-platform">Platform</Label>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger id="public-profile-platform" className="w-[160px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PLATFORMS.map((p) => <SelectItem key={p} value={p}>{platformName(p)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 min-w-[200px] flex-1">
          <Label htmlFor="public-profile-handle">Handle</Label>
          <Input id="public-profile-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
        </div>
        <Button variant="outline" onClick={() => void add()} disabled={!!busy || !handle.trim()}>
          {busy === "add" ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </div>
      {notSaved && <p role="status" className="t-label">Not saved yet. What you entered is kept here.</p>}
    </div>
  );
}
