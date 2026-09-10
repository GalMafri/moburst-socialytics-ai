// A short clip built from the brand's own designed frames.
//
// Generative video was the wrong tool for these posts. A designed post is a
// layout with type in it; asked to animate one, Veo warps the lettering, or
// keeps the frame still and adds nothing, or drifts into a different scene.
// What these posts actually need is what a designer would cut: the design
// itself, held, with a slow move on it and a clean dissolve between beats.
// That is deterministic, always on brand, and takes seconds.
//
// Encoding: WebCodecs + mp4-muxer where the browser has them (a real H.264
// mp4, which is what every social platform wants), MediaRecorder/WebM as the
// fallback.

import { Muxer, ArrayBufferTarget } from "mp4-muxer";

export interface MotionOptions {
  /** Frames in order. One frame is a held design with a slow move on it. */
  images: HTMLImageElement[];
  width: number;
  height: number;
  /** Whole clip length. */
  seconds?: number;
  fps?: number;
  /** Cross-dissolve between beats. */
  dissolveSeconds?: number;
  onProgress?: (fraction: number) => void;
}

export interface MotionResult {
  blob: Blob;
  mimeType: "video/mp4" | "video/webm";
  seconds: number;
}

/** Ken Burns: alternating slow push-in and pull-back, with a little drift. */
function moveFor(index: number, t: number): { scale: number; dx: number; dy: number } {
  const pushIn = index % 2 === 0;
  const from = pushIn ? 1.0 : 1.08;
  const to = pushIn ? 1.08 : 1.0;
  // Ease in and out so the move never starts or stops abruptly.
  const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const scale = from + (to - from) * e;
  const drift = (index % 4 < 2 ? 1 : -1) * 0.012;
  return { scale, dx: drift * e, dy: -drift * 0.6 * e };
}

/** Draws one frame of the clip: the design, moved, with the next beat mixed in. */
function paint(
  ctx: CanvasRenderingContext2D,
  images: HTMLImageElement[],
  width: number,
  height: number,
  time: number,
  perBeat: number,
  dissolve: number,
): void {
  ctx.clearRect(0, 0, width, height);
  const beat = Math.min(images.length - 1, Math.floor(time / perBeat));
  const local = (time - beat * perBeat) / perBeat;

  const drawBeat = (i: number, t: number, alpha: number) => {
    const img = images[i];
    if (!img || alpha <= 0) return;
    const { scale, dx, dy } = moveFor(i, Math.max(0, Math.min(1, t)));
    // Cover the canvas at this scale, centred, then nudge.
    const base = Math.max(width / img.naturalWidth, height / img.naturalHeight);
    const w = img.naturalWidth * base * scale;
    const h = img.naturalHeight * base * scale;
    const x = (width - w) / 2 + dx * width;
    const y = (height - h) / 2 + dy * height;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  };

  drawBeat(beat, local, 1);
  // The last fraction of a beat mixes into the next one.
  const overlap = dissolve / perBeat;
  if (overlap > 0 && local > 1 - overlap && beat + 1 < images.length) {
    const mix = (local - (1 - overlap)) / overlap;
    drawBeat(beat + 1, mix * overlap, mix);
  }
}

function canUseWebCodecs(): boolean {
  return typeof (globalThis as any).VideoEncoder === "function" && typeof (globalThis as any).VideoFrame === "function";
}

/** H.264 mp4 through WebCodecs. Throws when the browser cannot encode. */
async function encodeMp4(o: Required<Omit<MotionOptions, "onProgress">> & { onProgress?: (f: number) => void }): Promise<MotionResult> {
  const { images, width, height, seconds, fps, dissolveSeconds } = o;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });
  const encoder = new (globalThis as any).VideoEncoder({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: unknown) => console.error("[motion] encoder", e),
  });
  // Level 4.0 covers 1080x1920 at 30 fps.
  encoder.configure({ codec: "avc1.640028", width, height, bitrate: 6_000_000, framerate: fps });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const total = Math.round(seconds * fps);
  const perBeat = seconds / images.length;

  for (let i = 0; i < total; i++) {
    paint(ctx, images, width, height, (i / fps), perBeat, dissolveSeconds);
    const frame = new (globalThis as any).VideoFrame(canvas, { timestamp: (i * 1e6) / fps, duration: 1e6 / fps });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (i % fps === 0) {
      o.onProgress?.(i / total);
      // Let the encoder drain so a long clip does not blow memory.
      if (encoder.encodeQueueSize > fps * 2) await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  const { buffer } = muxer.target as ArrayBufferTarget;
  return { blob: new Blob([buffer], { type: "video/mp4" }), mimeType: "video/mp4", seconds };
}

/** WebM through MediaRecorder, for browsers without WebCodecs. */
async function encodeWebm(o: Required<Omit<MotionOptions, "onProgress">> & { onProgress?: (f: number) => void }): Promise<MotionResult> {
  const { images, width, height, seconds, fps, dissolveSeconds } = o;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(fps);
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  recorder.start();

  const perBeat = seconds / images.length;
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const t = (performance.now() - started) / 1000;
      if (t >= seconds) return resolve();
      paint(ctx, images, width, height, t, perBeat, dissolveSeconds);
      o.onProgress?.(t / seconds);
      requestAnimationFrame(step);
    };
    step();
  });
  recorder.stop();
  await done;
  return { blob: new Blob(chunks, { type: "video/webm" }), mimeType: "video/webm", seconds };
}

/** The clip, as an mp4 where the browser can make one and a WebM otherwise. */
export async function renderMotionClip(options: MotionOptions): Promise<MotionResult> {
  const o = {
    images: options.images,
    width: Math.round(options.width / 2) * 2,
    height: Math.round(options.height / 2) * 2,
    seconds: options.seconds ?? 6,
    fps: options.fps ?? 30,
    dissolveSeconds: options.dissolveSeconds ?? 0.6,
    onProgress: options.onProgress,
  };
  if (!o.images.length) throw new Error("A clip needs at least one design");
  if (canUseWebCodecs()) {
    try {
      return await encodeMp4(o);
    } catch (e) {
      console.warn("[motion] mp4 encode failed, falling back to WebM:", e);
    }
  }
  return encodeWebm(o);
}

/** Pixel size for a platform's clip, from the aspect the generator uses. */
export function clipSize(aspect: string): { width: number; height: number } {
  if (aspect === "1:1") return { width: 1080, height: 1080 };
  if (aspect === "16:9") return { width: 1920, height: 1080 };
  if (aspect === "4:5") return { width: 1080, height: 1350 };
  return { width: 1080, height: 1920 };
}
