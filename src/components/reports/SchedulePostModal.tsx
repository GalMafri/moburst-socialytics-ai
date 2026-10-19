import { useState, useEffect } from "react";
import { formatDateTime, platformName, timeZoneName } from "@/lib/display";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Send, Loader2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { localDateString, scheduledInstant } from "@/lib/calendarDate";
import { sendQuietly } from "@/lib/quietSend";
import { postCopyOf } from "@/lib/postCopy";
import { publishProblems } from "../../../supabase/functions/_shared/sprout/publishRules";

interface SchedulePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  clientId: string;
  /** The report that planned the post; posts added to the calendar by hand have none. */
  reportId?: string;
  generatedMediaUrls?: string[];
  clientTimezone?: string;
}

const platformToNetworkTypes: Record<string, string[]> = {
  instagram: ["instagram", "fb_instagram_account"],
  tiktok: ["tiktok"],
  facebook: ["facebook"],
  linkedin: ["linkedin", "linkedin_company"],
  "twitter/x": ["twitter"],
  twitter: ["twitter"],
  youtube: ["youtube"],
  pinterest: ["pinterest"],
  threads: ["threads"],
};

export interface ScheduledRow { id: string; platform?: string | null; post_content?: string | null; scheduled_time?: string | null; status?: string | null; calendar_post_key?: string | null }

/** This post's Sprout post, if it has one: by the calendar post's key, else by platform and the start of the copy. */
export function scheduledFor(rows: ScheduledRow[] | null | undefined, post: { _calendarPostKey?: string; platform?: string; copy?: string } | null): ScheduledRow | null {
  if (!post) return null;
  const live = (rows ?? []).filter((r) => (r.status ?? "scheduled") === "scheduled");
  const byKey = post._calendarPostKey ? live.find((r) => r.calendar_post_key === post._calendarPostKey) : undefined;
  if (byKey) return byKey;
  const platform = (post.platform || "").toLowerCase();
  const copy = postCopyOf(post).trim().slice(0, 200);
  return live.find((r) => !r.calendar_post_key && (r.platform || "").toLowerCase() === platform && copy && (r.post_content || "").trim().slice(0, 200) === copy) ?? null;
}

/** The client's Sprout posts, as the post panel and this dialog read them. */
export function useScheduledPosts(clientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["scheduled-posts-full", clientId],
    enabled: !!clientId && enabled,
    retry: true,
    queryFn: async () => {
      const { data, error } = await supabase.from("scheduled_posts").select("*").eq("client_id", clientId!);
      if (error) throw error;
      return (data || []) as ScheduledRow[];
    },
  });
}

/**
 * Schedules one post to the client's Sprout profile (Lital's decision 4, 19
 * Oct 2026: staff schedule each post). The post is checked against what the
 * network accepts while it is prepared here, with the same rules the server
 * checks (publishRules.ts), so Sprout never refuses it. A request that does
 * not get through is sent again quietly. The dialog then shows the post's
 * state: scheduled for a time, or not scheduled yet, never a failure.
 */
export function SchedulePostModal({
  open,
  onOpenChange,
  post,
  clientId,
  reportId,
  generatedMediaUrls = [],
  clientTimezone = "UTC",
}: SchedulePostModalProps) {
  const queryClient = useQueryClient();
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [postContent, setPostContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState(false);
  const [notScheduled, setNotScheduled] = useState(false);
  const [justScheduled, setJustScheduled] = useState<string | null>(null);
  const mediaSignature = JSON.stringify(generatedMediaUrls);

  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  // Sprout's own data for the profiles, when it answers; the assigned rows are enough without it.
  const { data: apiProfiles } = useQuery({
    queryKey: ["sprout-profiles-all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sprout-profiles", { body: {} });
      if (error || data?.error) throw new Error("not listed");
      return (data?.profiles || []) as any[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  // The client's assigned profiles: the only publishing targets. Read again until it answers.
  const { data: dbProfiles } = useQuery({
    queryKey: ["sprout-profiles-assigned", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sprout_profiles").select("*").eq("client_id", clientId).neq("is_active", false);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: open && !!clientId,
    retry: true,
  });

  const { data: scheduledRows } = useScheduledPosts(clientId, open);
  const scheduled = scheduledFor(scheduledRows, post);
  const scheduledAt = justScheduled ?? scheduled?.scheduled_time ?? null;

  const assignedForPlatform = (dbProfiles || []).filter((p: any) => matchingNetworkTypes.includes((p.network_type || "").toLowerCase()));
  const displayProfiles = assignedForPlatform.map((dbP: any) => {
    const apiMatch = (apiProfiles || []).find((ap: any) => String(ap.id) === String(dbP.sprout_profile_id));
    return apiMatch ?? { ...dbP, id: dbP.sprout_profile_id, name: dbP.profile_name };
  });
  const autoSelected = displayProfiles.length === 1;

  useEffect(() => {
    if (!open) { setSelectedProfileId(""); setNotScheduled(false); setJustScheduled(null); return; }
    if (displayProfiles.length === 1) setSelectedProfileId(String(displayProfiles[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, displayProfiles.length]);

  // ── Populate form fields ────────────────────────────────────────────────────
  useEffect(() => {
    if (open && post) {
      // Copy and hashtags, without repeating a hashtag the copy already has.
      let content = postCopyOf(post).trim();
      if (post.hashtags?.length) {
        const tags = post.hashtags.map((h: string) => h.startsWith('#') ? h : `#${h}`);
        const existingTags = new Set((content.match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.toLowerCase()));
        const missingTags = [...new Set(tags)].filter((tag: string) => !existingTags.has(tag.toLowerCase()));
        if (missingTags.length) content += "\n\n" + missingTags.join(" ");
      }
      setPostContent(content);
      setMediaUrls(JSON.parse(mediaSignature));
      setScheduledDate("");
      setScheduledTime("");
      if (post.date_label) {
        const d = new Date(post.date_label);
        if (!isNaN(d.getTime())) setScheduledDate(/^\d{4}-\d{2}-\d{2}$/.test(post.date_label) ? post.date_label : localDateString(d));
      }
      if (post.posting_time) {
        const m = post.posting_time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (m) {
          let h = parseInt(m[1]);
          const ampm = m[3].toUpperCase();
          if (ampm === "PM" && h < 12) h += 12;
          if (ampm === "AM" && h === 12) h = 0;
          setScheduledTime(`${h.toString().padStart(2, "0")}:${m[2]}`);
        }
      }
    }
  }, [open, post, mediaSignature]);

  const selectedProfile = displayProfiles.find((p: any) => String(p.id) === selectedProfileId);
  const sendAt = scheduledDate && scheduledTime ? scheduledInstant(scheduledDate, scheduledTime, clientTimezone) : null;
  const problems = publishProblems({
    network: selectedProfile?.network_type || post?.platform,
    text: postContent,
    mediaUrls,
    sendAt: sendAt ?? "",
  });
  const ready = !!selectedProfile && !!sendAt && problems.length === 0;

  const handleSchedule = async () => {
    if (!ready || !sendAt) return;
    setScheduling(true);
    setNotScheduled(false);
    // Sent again only when it never reached the server; the server retries Sprout itself.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("schedule-sprout-post", {
      body: {
        client_id: clientId,
        report_id: reportId ?? null,
        calendar_post_key: post?._calendarPostKey ?? null,
        sprout_profile_id: Number(selectedProfileId),
        platform: post.platform,
        scheduled_time: sendAt,
        post_content: postContent,
        media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      },
    }));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts-full", clientId] }),
      queryClient.invalidateQueries({ queryKey: ["scheduled-posts", clientId] }),
    ]);
    setScheduling(false);
    if (error || !(data as any)?.success) {
      console.warn("[schedule] not scheduled yet", error ?? (data as any)?.error);
      setNotScheduled(true);
      return;
    }
    setJustScheduled(sendAt);
    toast.success(`Scheduled for ${formatDateTime(sendAt, { timeZone: clientTimezone })}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Schedule to Sprout Social
          </DialogTitle>
          <DialogDescription>
            {scheduledAt
              ? `Scheduled for ${formatDateTime(scheduledAt, { timeZone: clientTimezone })}.`
              : "The date, time, copy and media sent to the client's Sprout profile."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-profile">Sprout Profile</Label>

            {!dbProfiles && (
              <div className="flex items-center gap-2 t-secondary py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
              </div>
            )}

            {autoSelected && selectedProfile && (
              <div className="flex items-center gap-2 rounded-md border bg-[rgba(255,255,255,0.03)] px-3 py-2 t-body">
                <span className="font-medium">{selectedProfile.name || selectedProfile.native_name || "Profile"}</span>
                <Badge variant="secondary" className="t-label">{platformName(selectedProfile.network_type)}</Badge>
                <span className="ml-auto t-secondary">The client's {platformName(post?.platform)} account</span>
              </div>
            )}

            {!autoSelected && displayProfiles.length > 0 && (
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger id="schedule-profile">
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {displayProfiles.map((profile: any) => (
                    <SelectItem key={String(profile.id)} value={String(profile.id)}>
                      {profile.name || profile.native_name || "Profile"} ({platformName(profile.network_type)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {dbProfiles && displayProfiles.length === 0 && (
              <p className="t-secondary">This client has no {platformName(post?.platform) || "matching"} account in Sprout.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-date" className="flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden="true" /> Date</Label>
              <Input id="schedule-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-time" className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> Time ({timeZoneName(clientTimezone)})</Label>
              <Input id="schedule-time" type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="schedule-copy">Post copy (includes hashtags)</Label>
            <Textarea id="schedule-copy" value={postContent} onChange={(e) => setPostContent(e.target.value)} rows={6} className="whitespace-pre-wrap" />
          </div>

          {mediaUrls.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Attached Media ({mediaUrls.length} {mediaUrls.length === 1 ? "file" : "files"})
              </Label>
              <div className={mediaUrls.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
                {mediaUrls.map((url, i) => {
                  const isDataImage = url.startsWith("data:image/");
                  const isVideo = !isDataImage && (url.startsWith("data:video/") || url.startsWith("blob:") || /\.(mp4|webm|mov)(\?|#|$)/i.test(url) || url.includes("generativelanguage.googleapis.com") || url.includes("video"));
                  return isVideo ? (
                    <video key={i} src={url} controls className="w-full max-h-48 rounded-md border object-contain" />
                  ) : (
                    <img key={i} src={url} alt={`Media ${i + 1}`} className="w-full max-h-48 object-contain rounded-md border" />
                  );
                })}
              </div>
            </div>
          )}

          {/* What the post still needs, as facts about the post; the button waits for them. */}
          {selectedProfile && sendAt && problems.length > 0 && (
            <ul className="space-y-1" role="status">
              {problems.map((p) => <li key={p} className="t-secondary">{p}</li>)}
            </ul>
          )}
          {notScheduled && <p role="status" className="t-secondary">Not scheduled yet. Everything above is kept as it is.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSchedule()} disabled={scheduling || !ready}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {scheduledAt ? "Schedule again" : "Schedule Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
