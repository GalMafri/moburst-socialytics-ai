import { useState, useRef, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Scissors, Type, Download, Play, Loader2, Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

export interface VideoTrimmerProps {
  videoUrl: string;
  clientId?: string;
  onSave: (url: string) => void;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Singleton FFmpeg instance — loaded once, reused across editor opens
let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoaded = false;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance && ffmpegLoaded) return ffmpegInstance;

  ffmpegInstance = new FFmpeg();
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpegInstance.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegLoaded = true;
  return ffmpegInstance;
}

export function VideoTrimmer({ videoUrl, clientId, onSave, onClose }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [overlayText, setOverlayText] = useState("");
  const [overlayColor, setOverlayColor] = useState("#ffffff");
  const [overlayPosition, setOverlayPosition] = useState<"top" | "center" | "bottom">("bottom");
  const [fontSize, setFontSize] = useState(28);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [isDownloading, setIsDownloading] = useState(true);

  // Download video as blob on mount (needed for FFmpeg processing)
  useEffect(() => {
    let cancelled = false;
    setIsDownloading(true);

    const download = async () => {
      // Try direct fetch
      try {
        const res = await fetch(videoUrl, { mode: "cors" });
        if (res.ok) {
          const blob = await res.blob();
          if (!cancelled) setVideoBlob(blob);
          return;
        }
      } catch { /* CORS blocked */ }

      // Try proxy
      try {
        const { data } = await supabase.functions.invoke("proxy-media", {
          body: { url: videoUrl },
        });
        if (data?.data_url) {
          const res = await fetch(data.data_url);
          const blob = await res.blob();
          if (!cancelled) setVideoBlob(blob);
          return;
        }
      } catch { /* proxy failed */ }

      // If already a data URL, convert
      if (videoUrl.startsWith("data:")) {
        const res = await fetch(videoUrl);
        const blob = await res.blob();
        if (!cancelled) setVideoBlob(blob);
        return;
      }

      // Can still preview but not process
      if (!cancelled) toast.error("Could not download video for processing. Preview still works.");
    };

    download().finally(() => { if (!cancelled) setIsDownloading(false); });
    return () => { cancelled = true; };
  }, [videoUrl]);

  // Video duration detection — try multiple events
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const setDur = () => {
      const dur = video.duration;
      if (dur && isFinite(dur) && dur > 0 && duration === 0) {
        setDuration(dur);
        setTrimEnd(dur);
      }
    };
    video.addEventListener("loadedmetadata", setDur);
    video.addEventListener("loadeddata", setDur);
    video.addEventListener("durationchange", setDur);
    video.addEventListener("canplay", setDur);
    // Check immediately in case already loaded
    if (video.readyState >= 1) setDur();
    return () => {
      video.removeEventListener("loadedmetadata", setDur);
      video.removeEventListener("loadeddata", setDur);
      video.removeEventListener("durationchange", setDur);
      video.removeEventListener("canplay", setDur);
    };
  }, [duration]);

  // Playback time tracking + trim boundary enforcement
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (trimEndRef.current > 0 && video.currentTime >= trimEndRef.current && !video.paused) {
        video.pause();
        video.currentTime = trimStartRef.current;
      }
    };
    video.addEventListener("timeupdate", onTime);
    return () => video.removeEventListener("timeupdate", onTime);
  }, []);

  const handlePreview = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = trimStart;
    video.play();
  };

  // Capture thumbnail from current frame
  const extractThumbnail = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Draw text overlay on thumbnail too
    if (overlayText.trim()) {
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.fillStyle = overlayColor;
      let y: number;
      if (overlayPosition === "top") y = fontSize + 20;
      else if (overlayPosition === "center") y = canvas.height / 2;
      else y = canvas.height - 30;
      ctx.fillText(overlayText, canvas.width / 2, y);
    }
    const dataUrl = canvas.toDataURL("image/png");
    setThumbnailUrl(dataUrl);
    toast.success("Thumbnail captured!");
  };

  // REAL video processing with FFmpeg WASM
  const handleSave = async () => {
    const noTrim = trimStart < 0.1 && Math.abs(trimEnd - duration) < 0.2;
    const noOverlay = !overlayText.trim();

    if (noTrim && noOverlay) {
      onSave(videoUrl);
      return;
    }

    if (!videoBlob) {
      toast.error("Video not downloaded — can't process. Saving original.");
      onSave(videoUrl);
      return;
    }

    setIsProcessing(true);
    setProcessStatus("Loading video processor...");

    try {
      const ffmpeg = await getFFmpeg();

      // Write input video to FFmpeg virtual filesystem
      setProcessStatus("Preparing video...");
      const inputData = new Uint8Array(await videoBlob.arrayBuffer());
      await ffmpeg.writeFile("input.mp4", inputData);

      // Build FFmpeg command
      const args: string[] = [];

      // Trim: use -ss (start) and -to (end)
      if (!noTrim) {
        args.push("-ss", trimStart.toFixed(2));
        args.push("-to", trimEnd.toFixed(2));
      }

      args.push("-i", "input.mp4");

      // Text overlay using drawtext filter
      if (!noOverlay) {
        const yExpr =
          overlayPosition === "top" ? `${fontSize + 10}` :
          overlayPosition === "center" ? "(h-text_h)/2" :
          `h-th-20`;

        // Escape special characters for FFmpeg drawtext
        const safeText = overlayText.replace(/'/g, "\\'").replace(/:/g, "\\:");

        args.push(
          "-vf",
          `drawtext=text='${safeText}':fontsize=${fontSize}:fontcolor=${overlayColor}:x=(w-text_w)/2:y=${yExpr}:shadowcolor=black:shadowx=2:shadowy=2`,
        );
        args.push("-c:a", "copy"); // keep audio, re-encode video for filter
      } else {
        args.push("-c", "copy"); // stream copy (fast, no re-encode)
      }

      args.push("-y", "output.mp4");

      setProcessStatus(noOverlay ? "Trimming video..." : "Processing video with overlay...");
      await ffmpeg.exec(args);

      // Read output
      setProcessStatus("Finalizing...");
      const outputData = await ffmpeg.readFile("output.mp4");
      const outputBlob = new Blob([outputData], { type: "video/mp4" });

      if (outputBlob.size < 100) {
        throw new Error("Output video is empty");
      }

      // Upload to Supabase storage for persistence
      let finalUrl: string;
      try {
        setProcessStatus("Uploading...");
        const { data: uploaded } = await supabase.functions.invoke("upload-generated-media", {
          body: {
            client_id: clientId || "unknown",
            media_data: URL.createObjectURL(outputBlob),
            media_type: "video",
            file_name: `edited-video`,
          },
        });
        finalUrl = uploaded?.url || URL.createObjectURL(outputBlob);
      } catch {
        // Fallback: use blob URL (won't persist across refreshes but works for now)
        finalUrl = URL.createObjectURL(outputBlob);
      }

      // Clean up FFmpeg filesystem
      try { await ffmpeg.deleteFile("input.mp4"); } catch {}
      try { await ffmpeg.deleteFile("output.mp4"); } catch {}

      toast.success(`Video processed! (${(outputBlob.size / 1024 / 1024).toFixed(1)}MB)`);
      onSave(finalUrl);
    } catch (err: any) {
      console.error("FFmpeg processing error:", err);
      toast.error(`Processing failed: ${err.message}. Saving original.`);
      onSave(videoUrl);
    } finally {
      setIsProcessing(false);
      setProcessStatus("");
    }
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `video-${Date.now()}.mp4`;
    a.target = "_blank";
    a.click();
  };

  // CSS overlay for live preview
  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    left: 0, right: 0,
    textAlign: "center",
    fontSize: `${fontSize}px`,
    fontWeight: "bold",
    color: overlayColor,
    textShadow: "2px 2px 6px rgba(0,0,0,0.9), 0 0 20px rgba(0,0,0,0.5)",
    padding: "8px 16px",
    pointerEvents: "none",
    ...(overlayPosition === "top" && { top: "12px" }),
    ...(overlayPosition === "center" && { top: "50%", transform: "translateY(-50%)" }),
    ...(overlayPosition === "bottom" && { bottom: "52px" }),
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" /> Edit Video
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Video player with live text overlay */}
          <div className="relative rounded-md overflow-hidden border bg-black">
            <video ref={videoRef} src={videoUrl} controls className="w-full" preload="auto"
              onLoadedMetadata={() => {
                const v = videoRef.current;
                if (v && v.duration && isFinite(v.duration) && duration === 0) {
                  setDuration(v.duration);
                  setTrimEnd(v.duration);
                }
              }}
            />
            {overlayText.trim() && <div style={overlayStyle}>{overlayText}</div>}
          </div>

          <p className="text-xs text-center text-muted-foreground font-mono">
            {formatTime(currentTime)} / {formatTime(duration)}
            {isDownloading && <span className="ml-2 text-amber-500">Downloading for editing...</span>}
            {!isDownloading && videoBlob && (
              <span className="ml-2 text-green-600">Ready to process ({(videoBlob.size / 1024 / 1024).toFixed(1)}MB)</span>
            )}
          </p>

          {/* Trim */}
          <div className="space-y-3 border rounded-lg p-3">
            <Label className="text-sm font-medium flex items-center gap-1.5">
              <Scissors className="h-3.5 w-3.5" /> Trim
            </Label>
            {duration > 0 ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Start</span>
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formatTime(trimStart)}</span>
                  </div>
                  <Slider min={0} max={Math.max(trimEnd - 0.1, 0)} step={0.1} value={[trimStart]}
                    onValueChange={(v) => { setTrimStart(v[0]); if (videoRef.current) videoRef.current.currentTime = v[0]; }} />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">End</span>
                    <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{formatTime(trimEnd)}</span>
                  </div>
                  <Slider min={Math.max(trimStart + 0.1, 0.1)} max={duration} step={0.1} value={[trimEnd]}
                    onValueChange={(v) => { setTrimEnd(v[0]); if (videoRef.current) videoRef.current.currentTime = v[0]; }} />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Enter trim times manually (seconds):</p>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">Start (sec)</Label>
                    <Input type="number" min={0} step={0.1} value={trimStart}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setTrimStart(v);
                        if (videoRef.current) videoRef.current.currentTime = v;
                      }} className="h-8 text-xs" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs text-muted-foreground">End (sec)</Label>
                    <Input type="number" min={0.1} step={0.1} value={trimEnd || ""}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0;
                        setTrimEnd(v);
                        if (videoRef.current) videoRef.current.currentTime = v;
                      }} className="h-8 text-xs" />
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {duration > 0 ? `Duration: ${formatTime(trimEnd - trimStart)}` : "Play video to detect duration"}
              </p>
              <Button variant="outline" size="sm" onClick={handlePreview}>
                <Play className="h-3 w-3 mr-1" /> Preview
              </Button>
            </div>
          </div>

          {/* Text overlay */}
          <div className="space-y-3 border rounded-lg p-3">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <Type className="h-3.5 w-3.5" /> Text Overlay
              {overlayText.trim() && <span className="text-xs text-green-600 ml-1">(Live preview on video)</span>}
            </Label>
            <Input placeholder="Text to burn into the video" value={overlayText}
              onChange={(e) => setOverlayText(e.target.value)} />
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Color</Label>
                <Input type="color" value={overlayColor} onChange={(e) => setOverlayColor(e.target.value)} className="h-7 w-8 p-0.5 cursor-pointer" />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Position</Label>
                <Select value={overlayPosition} onValueChange={(v) => setOverlayPosition(v as any)}>
                  <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="top">Top</SelectItem>
                    <SelectItem value="center">Center</SelectItem>
                    <SelectItem value="bottom">Bottom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">Size</Label>
                <Input type="number" min={12} max={72} value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))} className="h-7 w-16 text-xs" />
              </div>
            </div>
          </div>

          {/* Thumbnail */}
          <div className="space-y-2 border rounded-lg p-3">
            <Label className="flex items-center gap-1.5 text-sm font-medium">
              <ImageIcon className="h-3.5 w-3.5" /> Thumbnail
            </Label>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={extractThumbnail}>
                <ImageIcon className="h-3 w-3 mr-1" /> Capture Frame
              </Button>
              {thumbnailUrl && (
                <a href={thumbnailUrl} download="thumbnail.png">
                  <Button variant="outline" size="sm">
                    <Download className="h-3 w-3 mr-1" /> Save
                  </Button>
                </a>
              )}
            </div>
            {thumbnailUrl && <img src={thumbnailUrl} alt="Thumbnail" className="w-32 rounded border" />}
          </div>

          {/* Processing status */}
          {isProcessing && (
            <div className="flex items-center gap-2 bg-primary/10 rounded-lg p-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-primary">{processStatus}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload} disabled={isProcessing}>
            <Download className="h-4 w-4 mr-1" /> Original
          </Button>
          <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isProcessing || isDownloading}>
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {processStatus || "Processing..."}</>
            ) : (
              <><Save className="h-4 w-4 mr-1" /> Save Edited Video</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
