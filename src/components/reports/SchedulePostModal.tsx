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

  // ── Fetch profiles assigned to this client in onboarding ────────────────────
  const {
    data: assignedProfiles,
    isLoading: loadingProfiles,
    error: profilesError,
  } = useQuery({
    queryKey: ["sprout-profiles-assigned", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .neq("is_active", false); // include rows where is_active is NULL or TRUE
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: open && !!clientId,
  });

  // ── Filter to profiles that match this post's platform ──────────────────────
  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  const platformProfiles = (assignedProfiles || []).filter((p: any) =>
    matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );

  // ── Auto-select: single match → pick it silently; multiple → let user choose ─
  useEffect(() => {
    if (!open) {
      setSelectedProfileId("");
      return;
    }
    if (platformProfiles.length === 1) {
      setSelectedProfileId(platformProfiles[0].sprout_profile_id?.toString());
    }
    // multiple profiles: keep blank so user picks one
  }, [open, platformProfiles.length]);

  // ── Populate form fields when modal opens ───────────────────────────────────
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

  // ── Resolve which profile object is selected (for display) ─────────────────
  const selectedProfile = platformProfiles.find(
    (p: any) => p.sprout_profile_id?.toString() === selectedProfileId
  );

  // ── Schedule handler ────────────────────────────────────────────────────────
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

      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          sprout_profile_id: selectedProfileId,
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_url: mediaUrl,
        },
      });

      // Surface the actual Sprout API error if the function returned one
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

  // ── Render ──────────────────────────────────────────────────────────────────
  const autoSelected = platformProfiles.length === 1;
  const noProfiles = !loadingProfiles && !profilesError && platformProfiles.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-4 w-4" /> Schedule to Sprout Social
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Profile section ── */}
          <div className="space-y-2">
            <Label>Sprout Profile</Label>

            {loadingProfiles && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading profiles…
              </div>
            )}

            {profilesError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Failed to load profiles: {(profilesError as Error).message}</span>
              </div>
            )}

            {/* Auto-detected: single profile — show as a read-only badge */}
            {autoSelected && selectedProfile && (
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

            {/* Multiple profiles: show a dropdown */}
            {!autoSelected && platformProfiles.length > 1 && (
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {platformProfiles.map((profile: any) => (
                    <SelectItem
                      key={profile.sprout_profile_id?.toString()}
                      value={profile.sprout_profile_id?.toString()}
                    >
                      {profile.profile_name || profile.native_name || "Profile"} ({profile.network_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* No matching profiles for this platform */}
            {noProfiles && (
              <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  No {post?.platform} profile is assigned to this client. Go to{" "}
                  <strong>Client Setup → Sprout Social</strong> to assign one.
                </span>
              </div>
            )}
          </div>

          {/* ── Date / Time ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Date
              </Label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> Time ({clientTimezone})
              </Label>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>

          {/* ── Post copy ── */}
          <div className="space-y-2">
            <Label>Post Copy</Label>
            <Textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              rows={4}
            />
          </div>

          {/* ── Attached media preview ── */}
          {mediaUrl && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <ImageIcon className="h-3 w-3" /> Attached Media
              </Label>
              <img
                src={mediaUrl}
                alt="Post media"
                className="w-full max-h-48 object-contain rounded-md border"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSchedule}
            disabled={scheduling || !selectedProfileId || loadingProfiles || noProfiles}
          >
            {scheduling ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Schedule Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
