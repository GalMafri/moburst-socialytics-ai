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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, Type, Download, Play, Pause, Plus, Trash2, GripVertical, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface VideoEditData {
  overlays: TextOverlay[];
  trimStart: number;
  trimEnd: number;
}

export interface VideoTrimmerProps {
  videoUrl: string;
  clientId?: string;
  initialEdits?: VideoEditData;
  onSave: (url: string, edits: VideoEditData) => void;
  onClose: () => void;
}

export interface TextOverlay {
  id: string;
  text: string;
  x: number; // percentage 0-100
  y: number; // percentage 0-100
  color: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
}

export function VideoTrimmer({ videoUrl, clientId, initialEdits, onSave, onClose }: VideoTrimmerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(initialEdits?.trimStart || 0);
  const [trimEnd, setTrimEnd] = useState(initialEdits?.trimEnd || 0);

  // Ref to avoid stale closure in event handlers
  const durationFoundRef = useRef(false);
  const trimStartRef = useRef(trimStart);
  const trimEndRef = useRef(trimEnd);
  trimStartRef.current = trimStart;
  trimEndRef.current = trimEnd;

  // Draggable text overlays — restore from saved edits if available
  const [overlays, setOverlays] = useState<TextOverlay[]>(initialEdits?.overlays || []);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Called from multiple video events to detect duration
  const tryDetectDuration = () => {
    if (durationFoundRef.current) return;
    const video = videoRef.current;
    if (!video) return;
    const d = video.duration;
    if (d && isFinite(d) && d > 0) {
      durationFoundRef.current = true;
      setDuration(d);
      setTrimEnd((prev) => prev === 0 ? d : prev);
    }
  };

  // Track time + enforce trim boundaries (called from onTimeUpdate on the video element)
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    tryDetectDuration();
    setCurrentTime(video.currentTime);
    if (trimEndRef.current > 0 && video.currentTime >= trimEndRef.current) {
      video.pause();
      video.currentTime = trimStartRef.current;
      setIsPlaying(false);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.pause();
    } else {
      if (video.currentTime < trimStart || video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
      }
      video.play();
    }
  };

  // ─── Timeline click to seek ───
  const handleTimelineClick = (e: React.MouseEvent) => {
    const timeline = timelineRef.current;
    const video = videoRef.current;
    if (!timeline || !video || duration === 0) return;
    const rect = timeline.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    video.currentTime = pct * duration;
  };

  // ─── Trim handle dragging ───
  const handleTrimDrag = (handle: "start" | "end", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const timeline = timelineRef.current;
    if (!timeline || duration === 0) return;

    const onMove = (moveE: MouseEvent) => {
      const rect = timeline.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (moveE.clientX - rect.left) / rect.width));
      const time = pct * duration;
      if (handle === "start") {
        setTrimStart(Math.min(time, trimEnd - 0.2));
        if (videoRef.current) videoRef.current.currentTime = Math.min(time, trimEnd - 0.2);
      } else {
        setTrimEnd(Math.max(time, trimStart + 0.2));
        if (videoRef.current) videoRef.current.currentTime = Math.max(time, trimStart + 0.2);
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ─── Draggable text overlay on video ───
  const handleOverlayDrag = (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const container = videoContainerRef.current;
    if (!container) return;
    setDragging(id);
    setSelectedOverlay(id);

    const rect = container.getBoundingClientRect();
    const onMove = (moveE: MouseEvent) => {
      const x = ((moveE.clientX - rect.left) / rect.width) * 100;
      const y = ((moveE.clientY - rect.top) / rect.height) * 100;
      setOverlays((prev) =>
        prev.map((o) => o.id === id ? { ...o, x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) } : o)
      );
    };
    const onUp = () => {
      setDragging(null);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const addTextOverlay = () => {
    const newOverlay: TextOverlay = {
      id: `overlay-${Date.now()}`,
      text: "Your text here",
      x: 50,
      y: 50,
      color: "#ffffff",
      fontSize: 24,
      fontWeight: "bold",
    };
    setOverlays((prev) => [...prev, newOverlay]);
    setSelectedOverlay(newOverlay.id);
  };

  const updateOverlay = (id: string, updates: Partial<TextOverlay>) => {
    setOverlays((prev) => prev.map((o) => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOverlay = (id: string) => {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    if (selectedOverlay === id) setSelectedOverlay(null);
  };

  const selectedOv = overlays.find((o) => o.id === selectedOverlay);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processStatus, setProcessStatus] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `video-${Date.now()}.mp4`;
    a.target = "_blank";
    a.click();
  };

  // Draw text overlays on canvas
  const drawOverlaysOnCanvas = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    for (const ov of overlays) {
      if (!ov.text.trim()) continue;
      ctx.save();
      ctx.font = `${ov.fontWeight} ${ov.fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "rgba(0,0,0,0.8)";
      ctx.shadowBlur = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;
      ctx.fillStyle = ov.color;
      ctx.fillText(ov.text, (ov.x / 100) * w, (ov.y / 100) * h);
      ctx.restore();
    }
  };

  // Process video: download as blob → canvas+MediaRecorder → upload
  const handleSave = async () => {
    const edits: VideoEditData = { overlays, trimStart, trimEnd };
    const hasOverlays = overlays.some((o) => o.text.trim());
    const hasTrim = trimStart > 0.1 || (duration > 0 && Math.abs(trimEnd - duration) > 0.2);

    // No edits — just save metadata and return original URL
    if (!hasOverlays && !hasTrim) {
      onSave(videoUrl, edits);
      return;
    }

    setIsProcessing(true);

    try {
      // Step 1: Get a CORS-free video blob
      setProcessStatus("Downloading video...");
      let videoBlob: Blob | null = null;

      // Try direct fetch
      try {
        const res = await fetch(videoUrl, { mode: "cors" });
        if (res.ok) videoBlob = await res.blob();
      } catch {}

      // Try proxy
      if (!videoBlob) {
        try {
          const { data } = await supabase.functions.invoke("proxy-media", {
            body: { url: videoUrl },
          });
          if (data?.data_url) {
            const res = await fetch(data.data_url);
            videoBlob = await res.blob();
          }
        } catch {}
      }

      if (!videoBlob) {
        toast.error("Couldn't download video for processing. Saving edits as metadata only.");
        onSave(videoUrl, edits);
        return;
      }

      // Step 2: Create a hidden video element from the blob (CORS-free)
      setProcessStatus("Processing video...");
      const blobUrl = URL.createObjectURL(videoBlob);
      const processingVideo = document.createElement("video");
      processingVideo.src = blobUrl;
      processingVideo.muted = true;
      processingVideo.playsInline = true;

      await new Promise<void>((resolve, reject) => {
        processingVideo.onloadeddata = () => resolve();
        processingVideo.onerror = () => reject(new Error("Failed to load video for processing"));
        setTimeout(() => resolve(), 5000); // fallback
      });

      const vw = processingVideo.videoWidth || 720;
      const vh = processingVideo.videoHeight || 1280;
      const canvas = canvasRef.current || document.createElement("canvas");
      canvas.width = vw;
      canvas.height = vh;
      const ctx = canvas.getContext("2d")!;

      // Step 3: Canvas stream + MediaRecorder
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : "video/mp4";

      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

      const recordingDone = new Promise<Blob>((resolve) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      });

      // Safety timeout
      const safetyTimeout = setTimeout(() => {
        if (recorder.state === "recording") { processingVideo.pause(); recorder.stop(); }
      }, 30000);

      // Seek to trim start
      const effectiveStart = hasTrim ? trimStart : 0;
      const effectiveEnd = hasTrim && trimEnd > 0 ? trimEnd : (processingVideo.duration || 10);
      processingVideo.currentTime = effectiveStart;
      await new Promise<void>((r) => { processingVideo.onseeked = () => r(); setTimeout(r, 2000); });

      // Verify canvas can draw (CORS check)
      try {
        ctx.drawImage(processingVideo, 0, 0, vw, vh);
        canvas.toDataURL();
      } catch {
        URL.revokeObjectURL(blobUrl);
        toast.error("Browser blocked video processing. Saving edits as metadata only.");
        onSave(videoUrl, edits);
        return;
      }

      // Step 4: Record
      recorder.start(100);
      await processingVideo.play();

      setProcessStatus("Recording edited video...");
      const renderLoop = () => {
        if (processingVideo.currentTime >= effectiveEnd || processingVideo.paused || processingVideo.ended) {
          processingVideo.pause();
          if (recorder.state === "recording") recorder.stop();
          return;
        }
        try {
          ctx.drawImage(processingVideo, 0, 0, vw, vh);
          if (hasOverlays) drawOverlaysOnCanvas(ctx, vw, vh);
        } catch {}
        requestAnimationFrame(renderLoop);
      };
      requestAnimationFrame(renderLoop);

      const outputBlob = await recordingDone;
      clearTimeout(safetyTimeout);
      URL.revokeObjectURL(blobUrl);

      if (outputBlob.size < 100) {
        toast.error("Processing produced empty video. Saving edits as metadata only.");
        onSave(videoUrl, edits);
        return;
      }

      // Step 5: Upload processed video
      setProcessStatus("Uploading...");
      let finalUrl: string;
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(outputBlob);
        });
        const { data: uploaded } = await supabase.functions.invoke("upload-generated-media", {
          body: { client_id: clientId || "unknown", media_data: dataUrl, media_type: "video", file_name: "edited-video" },
        });
        finalUrl = uploaded?.url || URL.createObjectURL(outputBlob);
      } catch {
        finalUrl = URL.createObjectURL(outputBlob);
      }

      toast.success(`Video processed! (${(outputBlob.size / 1024 / 1024).toFixed(1)}MB)`);
      onSave(finalUrl, edits);
    } catch (err: any) {
      console.error("Video save error:", err);
      toast.error("Processing failed. Saving edits as metadata only.");
      onSave(videoUrl, { overlays, trimStart, trimEnd });
    } finally {
      setIsProcessing(false);
      setProcessStatus("");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[95vh] overflow-y-auto p-4">
        <DialogHeader>
          <DialogTitle>Edit Video</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* ─── Video canvas with draggable text overlays ─── */}
          <div
            ref={videoContainerRef}
            className="relative rounded-lg overflow-hidden border bg-black select-none"
            onClick={() => setSelectedOverlay(null)}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full"
              preload="auto"
              playsInline
              controls
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => { tryDetectDuration(); setIsPlaying(true); }}
              onPause={() => setIsPlaying(false)}
              onLoadedMetadata={tryDetectDuration}
              onLoadedData={tryDetectDuration}
              onCanPlay={tryDetectDuration}
              onDurationChange={tryDetectDuration}
            />

            {/* Draggable text overlays */}
            {overlays.map((ov) => (
              <div
                key={ov.id}
                className={`absolute cursor-move select-none ${
                  selectedOverlay === ov.id ? "ring-2 ring-blue-500 ring-offset-1" : ""
                } ${dragging === ov.id ? "opacity-80" : ""}`}
                style={{
                  left: `${ov.x}%`,
                  top: `${ov.y}%`,
                  transform: "translate(-50%, -50%)",
                  fontSize: `${ov.fontSize}px`,
                  fontWeight: ov.fontWeight,
                  color: ov.color,
                  textShadow: "2px 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)",
                  whiteSpace: "nowrap",
                  zIndex: selectedOverlay === ov.id ? 20 : 10,
                }}
                onMouseDown={(e) => handleOverlayDrag(ov.id, e)}
                onClick={(e) => { e.stopPropagation(); setSelectedOverlay(ov.id); }}
              >
                {ov.text}
              </div>
            ))}

            {/* Play overlay — only when no native controls interaction */}
          </div>

          {/* ─── Visual timeline with trim handles ─── */}
          <div className="space-y-1">
            <div
              ref={timelineRef}
              className="relative h-10 bg-muted rounded-md cursor-pointer overflow-hidden"
              onClick={handleTimelineClick}
            >
              {/* Trimmed-out zones (dimmed) */}
              {duration > 0 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 left-0 bg-black/40 z-10"
                    style={{ width: `${(trimStart / duration) * 100}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 right-0 bg-black/40 z-10"
                    style={{ width: `${((duration - trimEnd) / duration) * 100}%` }}
                  />
                </>
              )}

              {/* Active trim region */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 bg-primary/20 border-y-2 border-primary z-10"
                  style={{
                    left: `${(trimStart / duration) * 100}%`,
                    width: `${((trimEnd - trimStart) / duration) * 100}%`,
                  }}
                />
              )}

              {/* Playhead */}
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-20 shadow-lg"
                  style={{ left: `${(currentTime / duration) * 100}%` }}
                >
                  <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white rounded-full" />
                </div>
              )}

              {/* Trim handles */}
              {duration > 0 && (
                <>
                  <div
                    className="absolute top-0 bottom-0 w-3 bg-primary rounded-l cursor-ew-resize z-30 flex items-center justify-center hover:bg-primary/80"
                    style={{ left: `calc(${(trimStart / duration) * 100}% - 6px)` }}
                    onMouseDown={(e) => handleTrimDrag("start", e)}
                  >
                    <GripVertical className="h-4 w-4 text-primary-foreground" />
                  </div>
                  <div
                    className="absolute top-0 bottom-0 w-3 bg-primary rounded-r cursor-ew-resize z-30 flex items-center justify-center hover:bg-primary/80"
                    style={{ left: `calc(${(trimEnd / duration) * 100}% - 6px)` }}
                    onMouseDown={(e) => handleTrimDrag("end", e)}
                  >
                    <GripVertical className="h-4 w-4 text-primary-foreground" />
                  </div>
                </>
              )}

              {/* Timeline fallback — click video to play, which triggers duration detection */}
              {duration === 0 && (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  Click play on the video to load timeline
                </div>
              )}
            </div>

            {/* Time labels */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>{fmt(trimStart)}</span>
              <span className="text-foreground font-medium">{fmt(currentTime)}</span>
              <span>{fmt(trimEnd)}{duration > 0 && ` / ${fmt(duration)}`}</span>
            </div>
          </div>

          {/* ─── Playback controls ─── */}
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={togglePlay}>
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <span className="text-xs text-muted-foreground">
              Trim: {fmt(trimStart)} → {fmt(trimEnd)} ({fmt(trimEnd - trimStart)})
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              Drag the colored handles to trim
            </span>
          </div>

          {/* ─── Text overlays panel ─── */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Type className="h-3.5 w-3.5" /> Text Overlays ({overlays.length})
              </Label>
              <Button variant="outline" size="sm" onClick={addTextOverlay}>
                <Plus className="h-3 w-3 mr-1" /> Add Text
              </Button>
            </div>

            {overlays.length === 0 && (
              <p className="text-xs text-muted-foreground">Click "Add Text" to place text on the video. Drag to position.</p>
            )}

            {/* Overlay list */}
            {overlays.map((ov) => (
              <div
                key={ov.id}
                className={`flex items-center gap-2 p-2 rounded border text-sm ${
                  selectedOverlay === ov.id ? "border-primary bg-primary/5" : "border-border"
                }`}
                onClick={() => setSelectedOverlay(ov.id)}
              >
                <div
                  className="w-4 h-4 rounded-full border flex-shrink-0"
                  style={{ backgroundColor: ov.color }}
                />
                <span className="truncate flex-1 text-xs">{ov.text}</span>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => removeOverlay(ov.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </Button>
              </div>
            ))}

            {/* Selected overlay editor */}
            {selectedOv && (
              <div className="space-y-2 pt-2 border-t">
                <Input
                  value={selectedOv.text}
                  onChange={(e) => updateOverlay(selectedOv.id, { text: e.target.value })}
                  placeholder="Enter text"
                  className="text-sm"
                />
                <div className="flex gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Color</Label>
                    <Input
                      type="color"
                      value={selectedOv.color}
                      onChange={(e) => updateOverlay(selectedOv.id, { color: e.target.value })}
                      className="h-7 w-8 p-0.5 cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Size</Label>
                    <Input
                      type="number"
                      min={12}
                      max={72}
                      value={selectedOv.fontSize}
                      onChange={(e) => updateOverlay(selectedOv.id, { fontSize: Number(e.target.value) })}
                      className="h-7 w-16 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <Label className="text-xs text-muted-foreground">Weight</Label>
                    <Select
                      value={selectedOv.fontWeight}
                      onValueChange={(v) => updateOverlay(selectedOv.id, { fontWeight: v as any })}
                    >
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="normal">Normal</SelectItem>
                        <SelectItem value="bold">Bold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">Drag the text on the video to reposition it.</p>
              </div>
            )}
          </div>

          {/* Hidden canvas for video processing */}
          <canvas ref={canvasRef} className="hidden" />

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
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isProcessing}>
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> {processStatus || "Processing..."}</>
            ) : (
              <><Save className="h-4 w-4 mr-1" /> Save & Apply Edits</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
