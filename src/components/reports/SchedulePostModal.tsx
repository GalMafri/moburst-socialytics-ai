import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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

// Map content calendar platform names to Sprout network_type values
const platformToNetworkTypes: Record<string, string[]> = {
  instagram: ["instagram", "fb_instagram_account"],
  tiktok: ["tiktok"],
  facebook: ["facebook"],
  linkedin: ["linkedin"],
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

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSelectedProfileId("");
    }
  }, [open]);

  // Always fetch all Sprout profiles directly from the API when modal opens
  const {
    data: allSproutProfiles,
    isLoading: loadingProfiles,
    error: profilesError,
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
    staleTime: 60_000, // cache for 1 minute
  });

  const profiles = allSproutProfiles || [];

  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  const platformProfiles = profiles.filter((p: any) => {
    const networkType = (p.network_type || "").toLowerCase();
    return matchingNetworkTypes.includes(networkType);
  });

  // Show all profiles as fallback if none match the platform
  const displayProfiles = platformProfiles.length > 0 ? platformProfiles : profiles;
  const noMatchWarning = platformProfiles.length === 0 && profiles.length > 0;

  // Fill in form fields when modal opens
  useEffect(() => {
    if (open && post) {
      setPostContent(post.copy || "");
      setMediaUrl(generatedImageUrl || null);

      if (post.date_label) {
        try {
          const d = new Date(post.date_label);
          if (!isNaN(d.getTime())) {
            setScheduledDate(d.toISOString().split("T")[0]);
          }
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

  // Auto-select first matching profile once profiles load
  useEffect(() => {
    if (open && displayProfiles.length > 0 && !selectedProfileId) {
      setSelectedProfileId(displayProfiles[0].id?.toString());
    }
  }, [open, displayProfiles, selectedProfileId]);

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
      const selectedProfile = profiles?.find(
        (p: any) => p.id?.toString() === selectedProfileId
      );

      // For API profiles, `id` IS the Sprout customer_profile_id
      const sproutId = selectedProfile?.sprout_profile_id || selectedProfile?.id;

      console.log("Scheduling post:", { sproutId, platform: post.platform, selectedProfile });

      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          profile_id: selectedProfileId,
          sprout_profile_id: sproutId,
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_url: mediaUrl,
        },
      });

      // Check both the invoke error AND the response body error
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
            <Label>Profile</Label>

            {loadingProfiles && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading Sprout profiles...
              </div>
            )}

            {profilesError && (
              <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 rounded-md p-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>Failed to load profiles: {(profilesError as Error).message}</span>
              </div>
            )}

            {!loadingProfiles && !profilesError && displayProfiles.length > 0 && (
              <>
                {noMatchWarning && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-2 py-1">
                    No {post?.platform} profiles found — showing all {profiles.length} connected profiles.
                  </p>
                )}
                <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select profile" />
                  </SelectTrigger>
                  <SelectContent>
                    {displayProfiles.map((profile: any) => (
                      <SelectItem key={profile.id?.toString()} value={profile.id?.toString()}>
                        {profile.profile_name || profile.native_name || profile.name || "Profile"} ({profile.network_type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}

            {!loadingProfiles && !profilesError && profiles.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No Sprout Social profiles found. Make sure your Sprout Social account is connected and credentials are configured.
              </p>
            )}
          </div>

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

          <div className="space-y-2">
            <Label>Post Copy</Label>
            <Textarea
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              rows={4}
            />
          </div>

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
            disabled={scheduling || !selectedProfileId || loadingProfiles}
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
