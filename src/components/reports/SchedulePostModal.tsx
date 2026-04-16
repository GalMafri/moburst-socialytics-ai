import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Send, Loader2, Image as ImageIcon, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

interface SchedulePostModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: any;
  clientId: string;
  reportId: string;
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

export function SchedulePostModal({
  open,
  onOpenChange,
  post,
  clientId,
  reportId,
  generatedMediaUrls = [],
  clientTimezone = "UTC",
}: SchedulePostModalProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [postContent, setPostContent] = useState("");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [scheduling, setScheduling] = useState(false);

  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  // ── Always fetch all Sprout API profiles when modal opens ───────────────────
  // This is the reliable source; DB-assigned profiles are an enhancement on top.
  const {
    data: apiProfiles,
    isLoading: loadingApi,
    error: apiError,
  } = useQuery({
    queryKey: ["sprout-profiles-all"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("sprout-profiles", {
        body: { customer_id: "1676448" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return (data?.profiles || []) as any[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  // ── DB-assigned profiles: used only for auto-detection ──────────────────────
  // Independent query — does NOT gate the API profiles query above.
  const { data: dbProfiles } = useQuery({
    queryKey: ["sprout-profiles-assigned", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .neq("is_active", false);
      return (data || []) as any[];
    },
    enabled: open && !!clientId,
  });

  // ── Compute which profiles to show ─────────────────────────────────────────
  // API profiles filtered to this platform
  const apiForPlatform = (apiProfiles || []).filter((p: any) =>
    matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );

  // DB-assigned profiles matched to this platform (for auto-detection)
  const assignedForPlatform = (dbProfiles || []).filter((p: any) =>
    matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );

  // If client has DB-assigned profiles for this platform, show only those.
  // Otherwise show all API profiles for this platform (or all API if none match).
  const hasDbAssigned = assignedForPlatform.length > 0;

  const displayProfiles = hasDbAssigned
    ? // Enrich DB records with full API profile data by matching sprout_profile_id
      assignedForPlatform.map((dbP: any) => {
        const apiMatch = (apiProfiles || []).find(
          (ap: any) => String(ap.id) === String(dbP.sprout_profile_id)
        );
        return apiMatch ?? { ...dbP, id: dbP.sprout_profile_id };
      })
    : apiForPlatform.length > 0
    ? apiForPlatform
    : (apiProfiles || []);

  const noMatchWarning = !hasDbAssigned && apiForPlatform.length === 0 && (apiProfiles || []).length > 0;
  const autoSelected = hasDbAssigned && assignedForPlatform.length === 1;

  // ── Auto-select when exactly one profile matches ────────────────────────────
  useEffect(() => {
    if (!open) { setSelectedProfileId(""); return; }
    if (displayProfiles.length === 1) {
      setSelectedProfileId(String(displayProfiles[0].id));
    }
  }, [open, displayProfiles.length]);

  // ── Populate form fields ────────────────────────────────────────────────────
  useEffect(() => {
    if (open && post) {
      // Build full post content: copy + hashtags (only if not already in copy)
      let content = (post.copy || "").trim();
      if (post.hashtags?.length) {
        const tags = post.hashtags.map((h: string) => h.startsWith('#') ? h : `#${h}`);
        // Check if hashtags are already present in the copy to avoid duplication
        const hasHashtagsInCopy = tags.some((tag: string) => content.includes(tag));
        if (!hasHashtagsInCopy) {
          content += "\n\n" + tags.join(" ");
        }
      }
      setPostContent(content);
      setMediaUrls(generatedMediaUrls.length > 0 ? generatedMediaUrls : []);
      if (post.date_label) {
        try {
          const d = new Date(post.date_label);
          if (!isNaN(d.getTime())) setScheduledDate(d.toISOString().split("T")[0]);
        } catch { setScheduledDate(""); }
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
  }, [open, post, generatedMediaUrls]);

  const selectedProfile = displayProfiles.find((p: any) => String(p.id) === selectedProfileId);

  // ── Schedule ────────────────────────────────────────────────────────────────
  const handleSchedule = async () => {
    if (!selectedProfileId) { toast.error("Please select a profile"); return; }
    if (!scheduledDate || !scheduledTime) { toast.error("Please set date and time"); return; }
    setScheduling(true);
    try {
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          sprout_profile_id: Number(selectedProfileId),
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
          media_url: mediaUrls.length === 1 ? mediaUrls[0] : undefined,
        },
      });
      if (error) throw new Error((data as any)?.error || error.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Post scheduled successfully!");
      onOpenChange(false);
    } catch (err: any) {
      console.error("Schedule error:", err);
      toast.error("Failed to schedule: " + err.message, { duration: 8000 });
    } finally {
      setScheduling(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Schedule to Sprout Social
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Sprout Profile</Label>

            {loadingApi && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
              </div>
            )}

            {apiError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Failed to load profiles: {(apiError as Error).message}</span>
              </div>
            )}

            {/* Auto-detected: single DB-assigned profile for this platform */}
            {!loadingApi && autoSelected && selectedProfile && (
              <div className="flex items-center gap-2 rounded-md border bg-[rgba(255,255,255,0.03)] px-3 py-2 text-sm">
                <span className="font-medium">
                  {selectedProfile.name || selectedProfile.native_name || "Profile"}
                </span>
                <Badge variant="secondary" className="text-xs capitalize">
                  {selectedProfile.network_type}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">auto-detected</span>
              </div>
            )}

            {/* Dropdown: multiple profiles or API fallback */}
            {!loadingApi && !autoSelected && displayProfiles.length > 0 && (
              <>
                {noMatchWarning && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    No {post?.platform} profiles found — showing all connected profiles.
                    Assign the correct one in <strong>Client Setup → Sprout Social</strong>.
                  </p>
                )}
                {!hasDbAssigned && !noMatchWarning && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    Assign profiles in <strong>Client Setup → Sprout Social</strong> to enable auto-detection.
                  </p>
                )}
                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {displayProfiles.map((profile: any) => (
                      <SelectItem key={String(profile.id)} value={String(profile.id)}>
                        {profile.name || profile.native_name || "Profile"} ({profile.network_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {!loadingApi && !apiError && displayProfiles.length === 0 && (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>No Sprout Social profiles found. Check your credentials.</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Date</Label>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Clock className="h-3 w-3" /> Time ({clientTimezone})</Label>
              <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Post Copy (includes hashtags)</Label>
            <Textarea value={postContent} onChange={(e) => setPostContent(e.target.value)} rows={6} className="whitespace-pre-wrap" />
          </div>

          {mediaUrls.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Attached Media ({mediaUrls.length} {mediaUrls.length === 1 ? "file" : "files"})
              </Label>
              <div className={mediaUrls.length > 1 ? "grid grid-cols-2 gap-2" : ""}>
                {mediaUrls.map((url, i) => {
                  // Detect video by URL prefix/protocol — never match inside base64 data
                  const isDataImage = url.startsWith("data:image/");
                  const isVideo = !isDataImage && (
                    url.startsWith("data:video/") ||
                    url.startsWith("blob:") ||
                    url.endsWith(".mp4") ||
                    url.endsWith(".webm") ||
                    url.includes("generativelanguage.googleapis.com") ||
                    url.includes("video")
                  );
                  return isVideo ? (
                    <video key={i} src={url} controls className="w-full max-h-48 rounded-md border object-contain" />
                  ) : (
                    <img key={i} src={url} alt={`Media ${i + 1}`} className="w-full max-h-48 object-contain rounded-md border" />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSchedule} disabled={scheduling || !selectedProfileId || loadingApi}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Schedule Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
