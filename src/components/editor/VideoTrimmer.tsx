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
import { Save, Type, Download, Play, Pause, Plus, Trash2, GripVertical } from "lucide-react";
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

  // Draggable text overlays — restore from saved edits if available
  const [overlays, setOverlays] = useState<TextOverlay[]>(initialEdits?.overlays || []);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  // Duration detection — aggressive, tries everything
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let found = false;

    const trySetDuration = () => {
      if (found) return;
      const d = video.duration;
      if (d && isFinite(d) && d > 0) {
        found = true;
        setDuration(d);
        if (trimEnd === 0) setTrimEnd(d);
      }
    };

    // Listen to every possible event
    const events = ["loadedmetadata", "loadeddata", "durationchange", "canplay", "canplaythrough", "playing", "timeupdate"];
    events.forEach((ev) => video.addEventListener(ev, trySetDuration));

    // Check immediately
    trySetDuration();

    // Force load by briefly playing (some servers won't send metadata until playback starts)
    if (!found && video.readyState < 2) {
      video.muted = true;
      video.play()
        .then(() => {
          setTimeout(() => {
            trySetDuration();
            video.pause();
            video.currentTime = 0;
            video.muted = false;
          }, 200);
        })
        .catch(() => {}); // autoplay might be blocked
    }

    // Polling fallback — check every 500ms for 10s
    const pollId = setInterval(() => {
      trySetDuration();
      if (found) clearInterval(pollId);
    }, 500);
    const timeoutId = setTimeout(() => clearInterval(pollId), 10000);

    return () => {
      events.forEach((ev) => video.removeEventListener(ev, trySetDuration));
      clearInterval(pollId);
      clearTimeout(timeoutId);
    };
  }, []);

  // Playback tracking + trim enforcement
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTime = () => {
      setCurrentTime(video.currentTime);
      if (trimEnd > 0 && video.currentTime >= trimEnd) {
        video.pause();
        video.currentTime = trimStart;
        setIsPlaying(false);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [trimStart, trimEnd]);

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
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => {
            const edits: VideoEditData = { overlays, trimStart, trimEnd };
            onSave(videoUrl, edits);
            toast.success("Video edits saved");
          }}>
            <Save className="h-4 w-4 mr-1" /> Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
