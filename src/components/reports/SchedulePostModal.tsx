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
  generatedImageUrl?: string | null;
  clientTimezone?: string;
}

// All Sprout network_type values that map to each content-calendar platform name
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
  generatedImageUrl,
  clientTimezone = "UTC",
}: SchedulePostModalProps) {
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [postContent, setPostContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  // ── 1. Try DB-assigned profiles for this client (set in onboarding) ──────────
  const { data: assignedProfiles, isLoading: loadingAssigned } = useQuery({
    queryKey: ["sprout-profiles-assigned", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .neq("is_active", false);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: open && !!clientId,
  });

  const assignedForPlatform = (assignedProfiles || []).filter((p: any) =>
    matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );
  const hasAssignedProfiles = !!assignedProfiles; // query has resolved (even if empty)
  const useAssigned = assignedForPlatform.length > 0;

  // ── 2. Fallback: fetch all Sprout profiles from API if none assigned ──────────
  const {
    data: allApiProfiles,
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
      // Normalize API shape to match DB shape so the rest of the code is uniform
      return ((data?.profiles || []) as any[]).map((p: any) => ({
        sprout_profile_id: p.id,           // customer_profile_id from API
        profile_name: p.name,
        native_name: p.native_name,
        network_type: p.network_type,
        native_link: p.native_link,
        _from_api: true,
      }));
    },
    enabled: open && hasAssignedProfiles && !useAssigned,
    staleTime: 60_000,
  });

  const apiForPlatform = (allApiProfiles || []).filter((p: any) =>
    matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );

  // ── Resolved profile list ────────────────────────────────────────────────────
  // Prefer assigned profiles; fall back to all-API profiles filtered by platform;
  // last resort: all API profiles (any platform) so user can always pick something.
  const platformProfiles = useAssigned
    ? assignedForPlatform
    : apiForPlatform.length > 0
    ? apiForPlatform
    : (allApiProfiles || []);

  const noMatchWarning = !useAssigned && apiForPlatform.length === 0 && (allApiProfiles || []).length > 0;
  const isLoading = loadingAssigned || (!useAssigned && hasAssignedProfiles && loadingApi);
  const loadError = !useAssigned ? apiError : null;

  // ── Auto-select single match ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setSelectedProfileId("");
      return;
    }
    if (platformProfiles.length === 1) {
      setSelectedProfileId(String(platformProfiles[0].sprout_profile_id));
    }
  }, [open, platformProfiles.length]);

  // ── Populate form fields ─────────────────────────────────────────────────────
  useEffect(() => {
    if (open && post) {
      setPostContent(post.copy || "");
      setMediaUrl(generatedImageUrl || null);

      if (post.date_label) {
        try {
          const d = new Date(post.date_label);
          if (!isNaN(d.getTime())) setScheduledDate(d.toISOString().split("T")[0]);
        } catch {
          setScheduledDate("");
        }
      }

      if (post.posting_time) {
        const timeMatch = post.posting_time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const mins = timeMatch[2];
          const ampm = timeMatch[3].toUpperCase();
          if (ampm === "PM" && hours < 12) hours += 12;
          if (ampm === "AM" && hours === 12) hours = 0;
          setScheduledTime(`${hours.toString().padStart(2, "0")}:${mins}`);
        }
      }
    }
  }, [open, post, generatedImageUrl]);

  const selectedProfile = platformProfiles.find(
    (p: any) => String(p.sprout_profile_id) === selectedProfileId
  );
  const autoSelected = useAssigned && assignedForPlatform.length === 1;

  // ── Schedule ─────────────────────────────────────────────────────────────────
  const handleSchedule = async () => {
    if (!selectedProfileId) {
      toast.error("Please select a profile");
      return;
    }
    if (!scheduledDate || !scheduledTime) {
      toast.error("Please set date and time");
      return;
    }

    setScheduling(true);
    try {
      const scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}:00`);
      // Always send sprout_profile_id as a number (Sprout API requirement)
      const sproutId = Number(selectedProfileId);

      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          sprout_profile_id: sproutId,
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_url: mediaUrl,
        },
      });

      // Surface the actual Sprout API error from the response body
      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail);
      }
      if ((data as any)?.error) {
        throw new Error((data as any).error);
      }

      toast.success("Post scheduled successfully!");
      onOpenChange(false);
    } catch (err: any) {
      console.error("Schedule error:", err);
      toast.error("Failed to schedule: " + err.message, { duration: 8000 });
    } finally {
      setScheduling(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Schedule to Sprout Social
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Profile ── */}
          <div className="space-y-2">
            <Label>Sprout Profile</Label>

            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
              </div>
            )}

            {loadError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Failed to load profiles: {(loadError as Error).message}</span>
              </div>
            )}

            {/* Auto-detected single assigned profile: show as read-only badge */}
            {!isLoading && autoSelected && selectedProfile && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">
                  {selectedProfile.profile_name || selectedProfile.native_name || "Profile"}
                </span>
                <Badge variant="secondary" className="text-xs capitalize">
                  {selectedProfile.network_type}
                </Badge>
                <span className="ml-auto text-xs text-muted-foreground">auto-detected</span>
              </div>
            )}

            {/* Multiple profiles or fallback API profiles: show dropdown */}
            {!isLoading && !autoSelected && platformProfiles.length > 0 && (
              <>
                {noMatchWarning && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    No {post?.platform} profiles configured for this client — showing all connected profiles.
                    Assign the right ones in <strong>Client Setup → Sprout Social</strong>.
                  </p>
                )}
                {!useAssigned && !noMatchWarning && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    Showing all connected {post?.platform} profiles. Assign specific ones in{" "}
                    <strong>Client Setup → Sprout Social</strong> to enable auto-detection.
                  </p>
                )}
                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {platformProfiles.map((profile: any) => (
                      <SelectItem
                        key={String(profile.sprout_profile_id)}
                        value={String(profile.sprout_profile_id)}
                      >
                        {profile.profile_name || profile.native_name || "Profile"} ({profile.network_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {!isLoading && !loadError && platformProfiles.length === 0 && hasAssignedProfiles && (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Could not load any Sprout Social profiles. Check your Sprout credentials in the edge function settings.</span>
              </div>
            )}
          </div>

          {/* ── Date / Time ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Date
              </Label>
              <Input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Time ({clientTimezone})
              </Label>
              <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
            </div>
          </div>

          {/* ── Post copy ── */}
          <div className="space-y-2">
            <Label>Post Copy</Label>
            <Textarea value={postContent} onChange={(e) => setPostContent(e.target.value)} rows={4} />
          </div>

          {/* ── Media preview ── */}
          {mediaUrl && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Attached Media
              </Label>
              <img src={mediaUrl} alt="Post media" className="w-full max-h-48 object-contain rounded-md border" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSchedule} disabled={scheduling || !selectedProfileId || isLoading}>
            {scheduling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Schedule Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
