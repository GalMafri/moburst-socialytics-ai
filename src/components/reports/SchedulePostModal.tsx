import { useState, useEffect } from "react";
import { formatDateTime, platformName, timeZoneName } from "@/lib/display";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar, Clock, Send, Loader2, Image as ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { dateInputOf, scheduledInstant, timeInputOf } from "@/lib/calendarDate";
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

/** A post sent to Sprout: "scheduled" for a chosen time, or "publish_now" to go out now (schedule-sprout-post/send.ts). */
const SENT = ["scheduled", "publish_now"];

/** This post's Sprout post, if it has one: by the calendar post's key, else by platform and the start of the copy. */
export function scheduledFor(rows: ScheduledRow[] | null | undefined, post: { _calendarPostKey?: string; platform?: string; copy?: string } | null): ScheduledRow | null {
  if (!post) return null;
  const live = (rows ?? []).filter((r) => SENT.includes(r.status ?? "scheduled"));
  const byKey = post._calendarPostKey ? live.find((r) => r.calendar_post_key === post._calendarPostKey) : undefined;
  if (byKey) return byKey;
  const platform = (post.platform || "").toLowerCase();
  const copy = postCopyOf(post).trim().slice(0, 200);
  return live.find((r) => !r.calendar_post_key && (r.platform || "").toLowerCase() === platform && copy && (r.post_content || "").trim().slice(0, 200) === copy) ?? null;
}

/**
 * Where a post stands in Sprout, in words. Sprout's API takes posts as
 * drafts only (api.sproutsocial.com/docs, Publishing Post Endpoints), so a
 * sent post is a draft on Sprout's calendar until someone schedules or
 * sends it there; the words say so.
 */
export function sproutStateText(row: Pick<ScheduledRow, "status" | "scheduled_time"> | null | undefined, timeZone?: string): string {
  if (!row?.scheduled_time) return "Not sent to Sprout yet.";
  const at = formatDateTime(row.scheduled_time, { timeZone });
  return row.status === "publish_now"
    ? `Sent to Sprout to go out now (${at}), as a draft. It goes out once someone sends it from Sprout.`
    : `In Sprout as a draft for ${at}. It goes out once someone schedules it in Sprout.`;
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
 * Sends one post to the client's Sprout profile (Lital's decision 4, 19 Oct
 * 2026: staff schedule each post), scheduled for a time or published now (2
 * Nov 2026). The post is checked against what the network accepts while it is
 * prepared here, with the same rules the server checks (publishRules.ts), so
 * Sprout never refuses it; the one-minute rule is for a chosen time only. A
 * request that does not get through is sent again quietly. The dialog then
 * shows the post's state: in Sprout for a time, or not sent yet, never a
 * failure.
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
  const [justSent, setJustSent] = useState<ScheduledRow | null>(null);
  /** "schedule": the chosen date and time. "now": the earliest minute Sprout takes. */
  const [mode, setMode] = useState<"schedule" | "now">("schedule");
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
  const sentState = justSent ?? scheduled;

  const assignedForPlatform = (dbProfiles || []).filter((p: any) => matchingNetworkTypes.includes((p.network_type || "").toLowerCase()));
  const displayProfiles = assignedForPlatform.map((dbP: any) => {
    const apiMatch = (apiProfiles || []).find((ap: any) => String(ap.id) === String(dbP.sprout_profile_id));
    return apiMatch ?? { ...dbP, id: dbP.sprout_profile_id, name: dbP.profile_name };
  });
  const autoSelected = displayProfiles.length === 1;

  useEffect(() => {
    if (!open) { setSelectedProfileId(""); setNotScheduled(false); setJustSent(null); setMode("schedule"); return; }
    if (displayProfiles.length === 1) setSelectedProfileId(String(displayProfiles[0].id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, displayProfiles.length]);

  // ── Populate form fields ────────────────────────────────────────────────────
  // Filled when the dialog opens and when the post itself changes. The
  // calendar hands over a new post object each time it draws, so the post is
  // compared by what it says: a redraw never puts back what a person changed.
  const postSignature = post ? JSON.stringify([post._calendarPostKey, postCopyOf(post), post.hashtags, post.date_label, post.posting_time]) : "";
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
      setScheduledDate(dateInputOf(post.date_label));
      setScheduledTime(timeInputOf(post.posting_time));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, postSignature, mediaSignature]);

  const selectedProfile = displayProfiles.find((p: any) => String(p.id) === selectedProfileId);
  // The send time in the client's zone. A time the clock change skips or
  // repeats, or a zone that is not one, is said in its own words.
  let sendAt: string | null = null;
  let timeProblem: string | null = null;
  if (mode === "schedule" && scheduledDate && scheduledTime) {
    try { sendAt = scheduledInstant(scheduledDate, scheduledTime, clientTimezone); } catch (e) { timeProblem = e instanceof Error ? e.message : "Enter a valid date and time."; }
  }
  const problems = publishProblems({
    network: selectedProfile?.network_type || post?.platform,
    text: postContent,
    mediaUrls,
    sendAt: sendAt ?? "",
    format: post?.format,
  });
  // Everything that keeps the button waiting, in words. The profile list says
  // itself while it loads and when the client has no account for the network.
  const waitingFor = [
    ...(displayProfiles.length > 1 && !selectedProfile ? ["Choose the profile to post to."] : []),
    ...(mode === "now" ? [] : !scheduledDate && !scheduledTime ? ["Choose a date and time."] : !scheduledDate ? ["Choose a date."] : !scheduledTime ? ["Choose a time."] : []),
    ...(timeProblem ? [timeProblem] : []),
    ...problems,
  ];
  const ready = !!selectedProfile && (mode === "now" || !!sendAt) && problems.length === 0;

  const handleSend = async () => {
    if (!ready || (mode === "schedule" && !sendAt)) return;
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
        ...(mode === "now" ? { publish_now: true } : { scheduled_time: sendAt }),
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
      console.warn("[schedule] not sent yet", error ?? (data as any)?.error);
      setNotScheduled(true);
      return;
    }
    const sent: ScheduledRow = { id: "just-sent", status: (data as any).status ?? (mode === "now" ? "publish_now" : "scheduled"), scheduled_time: (data as any).scheduled_time ?? sendAt };
    setJustSent(sent);
    toast.success(sproutStateText(sent, clientTimezone));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Send to Sprout Social
          </DialogTitle>
          <DialogDescription>
            {sentState?.scheduled_time
              ? sproutStateText(sentState, clientTimezone)
              : "The copy and media go to the client's Sprout profile as a draft, for the time chosen here. It goes out once someone schedules or sends it in Sprout."}
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

          <RadioGroup value={mode} onValueChange={(v) => setMode(v === "now" ? "now" : "schedule")} className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="now" id="send-now" />
              <Label htmlFor="send-now" className="t-body font-normal">Publish now</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="schedule" id="send-schedule" />
              <Label htmlFor="send-schedule" className="t-body font-normal">Schedule</Label>
            </div>
          </RadioGroup>

          {mode === "now" && <p className="t-secondary">Goes to Sprout for the next minute.</p>}
          {mode === "schedule" && <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="schedule-date" className="flex items-center gap-1"><Calendar className="h-3 w-3" aria-hidden="true" /> Date</Label>
              <Input id="schedule-date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="schedule-time" className="flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" /> Time ({timeZoneName(clientTimezone)})</Label>
              <Input id="schedule-time" type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
            </div>
          </div>}

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
          {dbProfiles && displayProfiles.length > 0 && waitingFor.length > 0 && (
            <ul className="space-y-1" role="status">
              {waitingFor.map((p) => <li key={p} className="t-secondary">{p}</li>)}
            </ul>
          )}
          {notScheduled && <p role="status" className="t-secondary">Not sent to Sprout yet. Everything above is kept as it is.</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSend()} disabled={scheduling || !ready}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {mode === "now" ? "Publish now" : sentState ? "Schedule again" : "Schedule Post"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
