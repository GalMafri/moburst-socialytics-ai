/**
 * A post's design, in its Design tab: one design per post (Lital, 13 Oct),
 * shown large. A carousel shows every slide, with arrows, a slide count and
 * a full-screen view. "Regenerate" makes a new design from the post as it is
 * now; the current design stays until the new one is ready, and earlier
 * designs can be put back in use.
 */

import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Download, Expand, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DesignProgressCard } from "./DesignProgressCard";
import { currentDesign, type DesignRequest, type DesignVersion } from "@/lib/designRequests";

interface Props {
  versions: DesignVersion[];
  /** The post's latest request, when one is being prepared. */
  preparing: DesignRequest | null;
  isStaff: boolean;
  /** Tailwind aspect class for the post's format, e.g. "aspect-[4/5]". */
  aspect: string;
  filenameStub: string;
  onCreate: () => void;
  creating: boolean;
  onUse: (iterationId: string) => void;
  usingId: string | null;
}

export function PostDesign({ versions, preparing, isStaff, aspect, filenameStub, onCreate, creating, onUse, usingId }: Props) {
  const design = currentDesign(versions);
  const earlier = versions.filter((v) => v !== design);
  const [showEarlier, setShowEarlier] = useState(false);
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);
  const isCarousel = (design?.urls.length ?? 0) > 1;

  if (!design) {
    return (
      <div className="space-y-4">
        {preparing ? (
          <DesignProgressCard request={preparing} isStaff={isStaff} />
        ) : (
          <div className="glass-inner border-dashed border-white/10 p-8 text-center space-y-3">
            <Sparkles className="h-6 w-6 mx-auto text-muted-foreground/60" aria-hidden />
            <p className="t-secondary">No design for this post yet.</p>
            <Button size="sm" onClick={onCreate} disabled={creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              Create design
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {preparing && <DesignProgressCard request={preparing} isStaff={isStaff} replacing />}

      <SlideViewer
        key={design.iterationId}
        urls={design.urls}
        aspect={aspect}
        onOpen={(index) => setLightbox({ urls: design.urls, index })}
      />

      <div className="flex items-center gap-2 flex-wrap">
        {design.isSelected ? (
          <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] bg-[rgba(185,224,69,0.10)] text-[#b9e045] text-sm font-medium">
            <Check className="h-3.5 w-3.5" aria-hidden /> In use for this post
          </span>
        ) : (
          <Button size="sm" className="h-9" onClick={() => onUse(design.iterationId)} disabled={usingId === design.iterationId}>
            {usingId === design.iterationId ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            Use this {isCarousel ? "carousel" : "design"}
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-9" onClick={onCreate} disabled={creating || !!preparing}>
          {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
          Regenerate
        </Button>
        <DownloadButton urls={design.urls} filenameStub={filenameStub} />
      </div>
      {!preparing && (
        <p className="t-secondary">Regenerate makes a new {isCarousel ? "carousel" : "design"} from the post as it is now, including any copy changes. This one stays until the new one is ready.</p>
      )}

      {earlier.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            className="inline-flex items-center gap-1.5 t-label hover:!text-white transition-colors"
            aria-expanded={showEarlier}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showEarlier ? "rotate-180" : ""}`} aria-hidden />
            Earlier designs ({earlier.length})
          </button>
          {showEarlier && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {earlier.map((v) => (
                <div key={v.iterationId} className="glass-inner overflow-hidden border border-white/5">
                  <button
                    type="button"
                    onClick={() => setLightbox({ urls: v.urls, index: 0 })}
                    className={`relative block w-full bg-black group ${aspect}`}
                    aria-label={`Open the design from ${dateLabel(v.createdAt)}`}
                  >
                    <img src={v.urls[0]} alt="" className="w-full h-full object-contain" />
                    {v.urls.length > 1 && <span className="absolute top-1.5 right-1.5 rounded-full bg-black/70 px-1.5 py-0.5 t-badge text-white">{v.urls.length} slides</span>}
                    <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <Expand className="h-4 w-4 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
                    </span>
                  </button>
                  <div className="p-2 space-y-1.5 bg-[rgba(0,0,0,0.4)]">
                    <p className="t-label">{dateLabel(v.createdAt)}</p>
                    <Button size="sm" variant="outline" className="w-full h-8" onClick={() => onUse(v.iterationId)} disabled={usingId === v.iterationId}>
                      {usingId === v.iterationId ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                      Use this one
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <SlideLightbox state={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

/** The design at a readable size; a carousel adds arrows, the slide count and every slide below. */
function SlideViewer({ urls, aspect, onOpen }: { urls: string[]; aspect: string; onOpen: (index: number) => void }) {
  const [index, setIndex] = useState(0);
  const count = urls.length;
  const go = useCallback((d: number) => setIndex((i) => Math.min(count - 1, Math.max(0, i + d))), [count]);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
    if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
  };
  const carousel = count > 1;

  return (
    <div
      className="space-y-2 outline-none"
      tabIndex={carousel ? 0 : -1}
      onKeyDown={carousel ? onKey : undefined}
      role={carousel ? "region" : undefined}
      aria-roledescription={carousel ? "carousel" : undefined}
      aria-label={carousel ? `Carousel, ${count} slides` : undefined}
    >
      <div className={`relative mx-auto w-full max-w-[440px] ${aspect} rounded-[12px] overflow-hidden bg-black border border-white/[0.06]`}>
        <button type="button" onClick={() => onOpen(index)} className="block w-full h-full group" aria-label={carousel ? `Slide ${index + 1} of ${count}, open full screen` : "Open full screen"}>
          <img src={urls[index]} alt={carousel ? `Slide ${index + 1} of ${count}` : "Post design"} className="w-full h-full object-contain" />
          <span className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Expand className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
          </span>
        </button>
        {carousel && (
          <>
            <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 t-badge text-white tabular-nums" aria-live="polite">{index + 1} / {count}</span>
            <ArrowButton side="left" disabled={index === 0} onClick={() => go(-1)} />
            <ArrowButton side="right" disabled={index === count - 1} onClick={() => go(1)} />
          </>
        )}
      </div>
      {carousel && (
        <div className="flex justify-center gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Slides">
          {urls.map((u, i) => (
            <button
              key={`${u}:${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`relative shrink-0 w-14 ${aspect} rounded-[6px] overflow-hidden bg-black border transition-colors ${i === index ? "border-[#b9e045] ring-1 ring-[#b9e045]/60" : "border-white/10 opacity-70 hover:opacity-100"}`}
            >
              <img src={u} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ArrowButton({ side, disabled, onClick }: { side: "left" | "right"; disabled: boolean; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous slide" : "Next slide"}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} h-9 w-9 rounded-full bg-black/60 border border-white/15 text-white flex items-center justify-center transition-opacity hover:bg-black/80 disabled:opacity-0 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b9e045]`}
    >
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

/** Full screen, with the same arrows and the arrow keys. */
function SlideLightbox({ state, onClose }: { state: { urls: string[]; index: number } | null; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  useEffect(() => { if (state) setIndex(state.index); }, [state]);
  const count = state?.urls.length ?? 0;
  const go = (d: number) => setIndex((i) => Math.min(count - 1, Math.max(0, i + d)));
  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-5xl bg-black/95 border-white/10 p-0 overflow-hidden"
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        <DialogTitle className="sr-only">{count > 1 ? `Slide ${index + 1} of ${count}` : "Post design"}</DialogTitle>
        {state && (
          <div className="relative">
            <img src={state.urls[index]} alt={count > 1 ? `Slide ${index + 1} of ${count}` : "Post design"} className="w-full h-auto max-h-[88vh] object-contain" />
            {count > 1 && (
              <>
                <span className="absolute top-3 left-3 rounded-full bg-black/70 px-2.5 py-1 t-badge text-white tabular-nums">{index + 1} / {count}</span>
                <ArrowButton side="left" disabled={index === 0} onClick={() => go(-1)} />
                <ArrowButton side="right" disabled={index === count - 1} onClick={() => go(1)} />
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DownloadButton({ urls, filenameStub }: { urls: string[]; filenameStub: string }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < urls.length; i++) {
        const blob = await (await fetch(urls[i])).blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = urls.length > 1 ? `${filenameStub}-slide-${i + 1}.png` : `${filenameStub}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" className="h-9" onClick={download} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
      {urls.length > 1 ? "Download slides" : "Download"}
    </Button>
  );
}

function dateLabel(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
