import { useState, useEffect } from "react";
import { formatDateTime, platformName, sproutDraftLine, timeZoneName } from "@/lib/display";
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
import { invokeErrorCode } from "@/lib/invokeError";
import { postCopyOf } from "@/lib/postCopy";
import { publishProblems } from "../../../supabase/functions/_shared/sprout/publishRules";
import { SEND_RUN_LIMIT_MS, sendCanStillBeRunning } from "../../../supabase/functions/_shared/sprout/sendWindow";
import { hashtagList } from "../../../supabase/functions/_shared/text/hashtags";

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

export interface ScheduledRow { id: string; platform?: string | null; post_content?: string | null; scheduled_time?: string | null; status?: string | null; calendar_post_key?: string | null; sprout_post_id?: string | null; created_at?: string | null }

/**
 * A post sent to Sprout: "scheduled" for a set time, or "sent_now" for the earliest minute (schedule-sprout-post/send.ts).
 * "asked" (Sprout is being asked) and "unconfirmed" (the send ended without Sprout's answer) may have a post in
 * Sprout, so they read as sent, never as not sent.
 */
// QA 22 Nov 2026: "published" (allowed by the table) is a sent post too; left out, it read as not sent.
const SENT = ["scheduled", "sent_now", "asked", "unconfirmed", "published"];

/** A send that holds its post: Sprout was asked and no post id was written. The table allows one per post. */
const holdsPost = (r: ScheduledRow) => (r.status === "asked" || r.status === "unconfirmed") && !r.sprout_post_id;

/**
 * Where a post's send stands, decided here once for every screen that shows it (the post panel's Schedule tab
 * and this dialog):
 * - "none": not sent.
 * - "being_sent": Sprout is being asked, no post id is written yet, and the send can still be running, so its
 *   answer may still come (sendWindow.ts, the edge function's own time limit from the row's created_at).
 * - "unconfirmed": the send is over and no post id was ever written: it ended without Sprout's answer
 *   ("unconfirmed"), or it stopped before it wrote anything ("asked" past its run). Sprout's API retrieves a post
 *   by its id only, so nothing can look it up; sending again closes that row.
 * - "sent": a draft is in Sprout for its time.
 */
export type SendState = "none" | "being_sent" | "unconfirmed" | "sent";

export function sendStateOf(row: ScheduledRow | null | undefined, now: number = Date.now()): SendState {
  if (!row) return "none";
  if (!holdsPost(row)) return "sent";
  if (row.status === "unconfirmed") return "unconfirmed";
  return sendCanStillBeRunning(row.created_at, now) ? "being_sent" : "unconfirmed";
}

/** The one line that says a post's send state, for staff. */
export function sendStateLine(row: ScheduledRow | null | undefined, timeZone?: string, now: number = Date.now()): string {
  const state = sendStateOf(row, now);
  if (state === "being_sent") return "This post is being sent to Sprout.";
  if (state === "unconfirmed") return "Sprout did not confirm this post. Send it again to be sure it is there.";
  // QA 22 Nov 2026: the line used to stay the same before and after the draft's time. Nothing reads Sprout
  // back yet, so once the time has passed it says where to see whether the draft was approved and posted.
  const at = formatDateTime(row?.scheduled_time, { timeZone, year: false });
  if (row?.status === "published" && at) return `Posted from Sprout for ${at}.`;
  const due = Date.parse(row?.scheduled_time ?? "");
  if (state === "sent" && Number.isFinite(due) && due < now) return `${sproutDraftLine(row?.scheduled_time, timeZone)} Its time has passed: whether it was approved and posted shows in Sprout.`;
  return sproutDraftLine(row?.scheduled_time, timeZone);
}

/**
 * The clock a send state is read at, for a screen that shows one post's send (a row) or several (the calendar
 * board's rows): the screen draws again the moment the next send shown can no longer be running, so "being
 * sent" turns to "not confirmed" by itself, and then again for the one after it.
 */
export function useSendClock(rows: ScheduledRow | ScheduledRow[] | null | undefined): number {
  const [, redraw] = useState(0);
  const now = Date.now();
  const ends = (Array.isArray(rows) ? rows : rows ? [rows] : [])
    .filter((r) => r.status === "asked" && !r.sprout_post_id)
    .map((r) => Date.parse(r.created_at ?? "") + SEND_RUN_LIMIT_MS)
    .filter((end) => Number.isFinite(end) && end >= now);
  const endsAt = ends.length ? Math.min(...ends) : NaN;
  useEffect(() => {
    const wait = endsAt - Date.now();
    if (!Number.isFinite(wait) || wait < 0) return;
    const timer = setTimeout(() => redraw((n) => n + 1), wait + 1);
    return () => clearTimeout(timer);
  }, [endsAt]);
  return Date.now();
}

/** What identifies a send row as it stands: it changes when the row is settled, closed or replaced. */
const rowKey = (r: ScheduledRow | null | undefined) => (r ? JSON.stringify([r.id, r.status ?? null, r.sprout_post_id ?? null, r.created_at ?? null]) : "none");

/** The row that says where a post's send stands: the one holding it if any, else the newest sent one. */
function standingRow(rows: ScheduledRow[]): ScheduledRow | null {
  if (!rows.length) return null;
  const held = rows.find(holdsPost);
  if (held) return held;
  return rows.reduce((a, b) => (Date.parse(b.created_at ?? "") > Date.parse(a.created_at ?? "") ? b : a));
}

/** This post's Sprout post, if it has one: by the calendar post's key, else by platform and the start of the copy. */
export function scheduledFor(rows: ScheduledRow[] | null | undefined, post: { _calendarPostKey?: string; platform?: string; copy?: string } | null): ScheduledRow | null {
  if (!post) return null;
  const live = (rows ?? []).filter((r) => SENT.includes(r.status ?? "scheduled"));
  const byKey = post._calendarPostKey ? standingRow(live.filter((r) => r.calendar_post_key === post._calendarPostKey)) : null;
  if (byKey) return byKey;
  const platform = (post.platform || "").toLowerCase();
  const copy = postCopyOf(post).trim().slice(0, 200);
  return standingRow(live.filter((r) => !r.calendar_post_key && (r.platform || "").toLowerCase() === platform && copy && (r.post_content || "").trim().slice(0, 200) === copy));
}

/** How long a send waits for the client's rows to be read again before it settles on the function's answer. */
const ROWS_WAIT_MS = 3_000;

async function readScheduledPosts(clientId: string): Promise<ScheduledRow[]> {
  const { data, error } = await supabase.from("scheduled_posts").select("*").eq("client_id", clientId);
  if (error) throw error;
  return (data || []) as ScheduledRow[];
}

/** The client's Sprout posts, as the post panel and this dialog read them. */
export function useScheduledPosts(clientId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["scheduled-posts-full", clientId],
    enabled: !!clientId && enabled,
    retry: true,
    queryFn: () => readScheduledPosts(clientId!),
  });
}

/**
 * Sends one post to the client's Sprout profile (Lital's decision 4, 19 Oct
 * 2026: staff schedule each post), for a set time or now. Sprout's API takes
 * posts as drafts only, so the post arrives in Sprout as a draft and is
 * approved there (Lital, 3 Nov 2026: released as drafts, with words that say
 * so). The post is checked against what the network accepts while it is
 * prepared here, with the same rules the server checks (publishRules.ts), so
 * Sprout never refuses it; the one-minute rule is for a set time only. A
 * request that does not get through is sent again quietly. The dialog then
 * shows the post's state: sent as a draft for a time, or not sent yet, never
 * a failure.
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
  /**
   * The server held the last press because another send of this post holds it (code send_in_progress): the key
   * of the row that holds the post then. Said on screen only, for as long as that row is the one holding it.
   */
  const [heldOn, setHeldOn] = useState<string | null>(null);
  /** The row this press made, as the server said it, with the answer of the rows query that stood when it was set. */
  const [justSent, setJustSent] = useState<{ row: ScheduledRow; answeredAt: number } | null>(null);
  /** "schedule": the set date and time. "now": the earliest minute Sprout takes. */
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

  const { data: scheduledRows, dataUpdatedAt } = useScheduledPosts(clientId, open);
  const scheduled = scheduledFor(scheduledRows, post);
  // The press's own row stands in only until the rows query answers again: from then on the rows say where the
  // post stands, so a change made elsewhere (another person's send, confirmed) shows here.
  const sentState = justSent && justSent.answeredAt === dataUpdatedAt ? justSent.row : scheduled;
  const sendState = sendStateOf(sentState, useSendClock(sentState));
  const heldOnPress = heldOn !== null && rowKey(scheduled) === heldOn;

  const assignedForPlatform = (dbProfiles || []).filter((p: any) => matchingNetworkTypes.includes((p.network_type || "").toLowerCase()));
  const displayProfiles = assignedForPlatform.map((dbP: any) => {
    const apiMatch = (apiProfiles || []).find((ap: any) => String(ap.id) === String(dbP.sprout_profile_id));
    return apiMatch ?? { ...dbP, id: dbP.sprout_profile_id, name: dbP.profile_name };
  });
  const autoSelected = displayProfiles.length === 1;

  useEffect(() => {
    if (!open) { setSelectedProfileId(""); setNotScheduled(false); setHeldOn(null); setJustSent(null); setMode("schedule"); return; }
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
      // A list whatever shape the post carries: a regenerated post may hold one string (QA 22 Nov 2026).
      const listed = hashtagList(post.hashtags);
      if (listed.length) {
        const tags = listed.map((h) => h.startsWith('#') ? h : `#${h}`);
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

  const rememberSent = (row: ScheduledRow) =>
    setJustSent({ row, answeredAt: queryClient.getQueryState(["scheduled-posts-full", clientId])?.dataUpdatedAt ?? 0 });

  const handleSend = async () => {
    if (!ready || (mode === "schedule" && !sendAt)) return;
    setScheduling(true);
    setNotScheduled(false);
    setHeldOn(null);
    setJustSent(null);
    // Where the post's send stands now, read from the rows as they are and the clock at this press: only a send
    // that is over and was never confirmed is closed by this one.
    let rows = scheduledRows;
    try {
      rows = await queryClient.fetchQuery({ queryKey: ["scheduled-posts-full", clientId], queryFn: () => readScheduledPosts(clientId), staleTime: 0, retry: false });
    } catch { /* the rows on screen */ }
    const holder = scheduledFor(rows, post);
    const supersede = sendStateOf(holder, Date.now()) === "unconfirmed" ? holder?.id : undefined;
    // Sent again only when it never reached the server; the server retries Sprout itself.
    const { data, error } = await sendQuietly(() => supabase.functions.invoke("schedule-sprout-post", {
      body: {
        client_id: clientId,
        report_id: reportId ?? null,
        calendar_post_key: post?._calendarPostKey ?? null,
        sprout_profile_id: Number(selectedProfileId),
        platform: post.platform,
        ...(mode === "now" ? { send_now: true } : { scheduled_time: sendAt }),
        // Sending again a post Sprout never confirmed: that one earlier send is closed and this one goes.
        ...(supersede ? { supersede } : {}),
        post_content: postContent,
        media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      },
    }));
    // QA 22 Nov 2026: the rows are read again, but the press waits for them only a short while. Their query is
    // retried until it answers, so a read that kept failing after a send that went through left Send spinning
    // and the dialog open over a post that was in Sprout. The outcome follows the function's own answer; the
    // rows go on being read in the background.
    await Promise.race([
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scheduled-posts-full", clientId] }),
        queryClient.invalidateQueries({ queryKey: ["scheduled-posts", clientId] }),
      ]),
      new Promise((resolve) => setTimeout(resolve, ROWS_WAIT_MS)),
    ]);
    setScheduling(false);
    if (error || !(data as any)?.success) {
      console.warn("[schedule] not sent yet", error ?? (data as any)?.error);
      const replied = (data as { code?: unknown } | null)?.code;
      const code = error ? await invokeErrorCode(error) : typeof replied === "string" ? replied : null;
      // Another send of this post is going: the server says so by its code (a 409 can also be a profile in no
      // Sprout group, where nothing is being sent). The line stays while the refetched row that holds the post
      // is the one that held it, and goes when that row changes.
      if (code === "send_in_progress") setHeldOn(rowKey(scheduledFor(queryClient.getQueryData<ScheduledRow[]>(["scheduled-posts-full", clientId]), post)));
      // The send ended without Sprout's answer: the post may be there, and the row says so in the description
      // ("Sprout did not confirm this post"). "This send did not go through" would say it is not. The dialog reads
      // the state from this local row until the rows query answers again, so it says so even when the refetch
      // did not.
      else if (code === "post_not_confirmed") { rememberSent({ id: "just-sent", status: "unconfirmed", scheduled_time: sendAt }); return; }
      else setNotScheduled(true);
      return;
    }
    const sent: ScheduledRow = { id: "just-sent", status: (data as any).status ?? (mode === "now" ? "sent_now" : "scheduled"), scheduled_time: (data as any).scheduled_time ?? sendAt };
    rememberSent(sent);
    toast.success(sproutDraftLine(sent.scheduled_time, clientTimezone));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Send to Sprout
          </DialogTitle>
          <DialogDescription>
            {sendState === "unconfirmed"
              ? sendStateLine(sentState, clientTimezone, Date.now())
              : heldOnPress
              ? "This post is already being sent."
              : sendState === "none"
              ? "The copy and media go to the client's Sprout profile."
              : sendStateLine(sentState, clientTimezone, Date.now())}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="schedule-profile">Sprout profile</Label>

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
              <Label htmlFor="send-now" className="t-body font-normal">Send to Sprout now</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="schedule" id="send-schedule" />
              <Label htmlFor="send-schedule" className="t-body font-normal">Send to Sprout for a set time</Label>
            </div>
          </RadioGroup>

          <p className="t-secondary">It arrives in Sprout as a draft. Approve it there to post it.</p>
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
                <ImageIcon className="h-3 w-3" /> Attached media ({mediaUrls.length} {mediaUrls.length === 1 ? "file" : "files"})
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
          {/* The outcome of this press. With no earlier send, the post is not in Sprout; with one, only this press failed. */}
          {/* QA 22 Nov 2026 (P61-02): Sprout drafts cannot be changed or removed from here, so a second send adds a second draft. */}
          {sendState === "sent" && !notScheduled && (
            <p className="t-secondary">Sending again makes a second draft in Sprout. The first draft stays there until it is removed in Sprout.</p>
          )}
          {notScheduled && (
            <p role="status" className="t-secondary">
              {sendState === "none" ? "Not sent to Sprout yet. Everything above is kept as it is." : "This send did not go through. Everything above is kept as it is."}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => void handleSend()} disabled={scheduling || !ready}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            {sentState ? "Send again" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
