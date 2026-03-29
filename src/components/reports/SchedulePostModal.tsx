import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Clock, Send, Loader2, Image as ImageIcon } from "lucide-react";
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

  const { data: profiles } = useQuery({
    queryKey: ["sprout-profiles", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sprout_profiles")
        .select("*")
        .eq("client_id", clientId)
        .neq("is_active", false);
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

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

  const postPlatform = (post?.platform || "").toLowerCase();
  const matchingNetworkTypes = platformToNetworkTypes[postPlatform] || [postPlatform];

  const platformProfiles = (profiles || []).filter(
    (p: any) => matchingNetworkTypes.includes((p.network_type || "").toLowerCase())
  );

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

      if (platformProfiles.length > 0 && !selectedProfileId) {
        setSelectedProfileId(platformProfiles[0].id);
      }
    }
  }, [open, post, generatedImageUrl]);

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
      const selectedProfile = profiles?.find((p: any) => p.id === selectedProfileId);

      const { data, error } = await supabase.functions.invoke("schedule-sprout-post", {
        body: {
          client_id: clientId,
          report_id: reportId,
          profile_id: selectedProfileId,
          sprout_profile_id: selectedProfile?.sprout_profile_id,
          platform: post.platform,
          scheduled_time: scheduledDateTime.toISOString(),
          post_content: postContent,
          media_url: mediaUrl,
        },
      });

      if (error) throw error;

      toast.success("Post scheduled successfully!");
      onOpenChange(false);
    } catch (err: any) {
      toast.error("Failed to schedule: " + err.message);
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
            {platformProfiles.length > 0 ? (
              <Select value={selectedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select profile" />
                </SelectTrigger>
                <SelectContent>
                  {platformProfiles.map((profile: any) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.profile_name || profile.native_name} ({profile.network_type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No {post?.platform} profiles connected for this client.
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
          <Button onClick={handleSchedule} disabled={scheduling || !selectedProfileId}>
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
