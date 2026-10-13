// supabase/functions/_shared/video/compose.ts
//
// A video post, put together (13 Oct: video must follow the client's own
// videos, carry the exact copy and the logo file, and have sound):
//   - the footage, made by the video model with the client's own published
//     videos as its reference, with its own sound;
//   - the hook, drawn by the image model in the type of the client's posts on
//     a transparent layer (its words checked), laid over the whole clip;
//   - the client's logo file at its habitual spot.
// ffmpeg joins them at the platform's size in an Anthropic-hosted sandbox
// (sandbox.ts), never on a laptop. This file only writes the script; it is
// free of Deno and network imports so it can be tested.

export const VIDEO_SIZE = { width: 1080, height: 1920 } as const;
/** The hook layer is drawn at this size (multiples of 16, nearest to 9:16) and scaled to VIDEO_SIZE. */
export const CARD_SIZE = { width: 1088, height: 1936 } as const;

export const TIMING = {
  /** The hook fades in over this long at the start. */
  fadeIn: 0.4,
  /** Footage seconds asked of the video model when the plan gives none. */
  footage: 8,
} as const;

export interface LogoBox { x: number; y: number; width: number }

export interface ComposeInput {
  footageUrl: string;
  /** The hook on a transparent PNG, the size of the frame. */
  overlayUrl: string;
  logoUrl: string;
  /** Where the logo file sits, in VIDEO_SIZE pixels. */
  logo: LogoBox;
  /** A signed upload URL for the finished MP4 (Supabase Storage, PUT). */
  uploadUrl: string;
  /** Signed upload URLs for stills of the footage alone, spread across it, read for stray writing. */
  frameUploads?: string[];
}

/** Single-quote a value for bash. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

const FIT = `scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height}:force_original_aspect_ratio=increase,crop=${VIDEO_SIZE.width}:${VIDEO_SIZE.height},setsar=1,fps=30`;

/**
 * The bash script that downloads the parts, joins them and uploads the result.
 * Its last line is "COMPOSED <bytes> <seconds> <audio streams>" on success;
 * any failing command stops it (set -e) with a non-zero exit.
 */
export function composeScript(input: ComposeInput): string {
  const { x, y, width } = input.logo;
  const filter = [
    `[0:v]${FIT},format=yuv420p[base]`,
    `[1:v]scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height},format=rgba,fade=t=in:st=0:d=${TIMING.fadeIn}:alpha=1[hook]`,
    `[2:v]scale=${Math.round(width)}:-1:flags=lanczos,format=rgba[logo]`,
    `[base][hook]overlay=0:0:shortest=1[v1]`,
    `[v1][logo]overlay=${Math.round(x)}:${Math.round(y)}:shortest=1,format=yuv420p[v]`,
  ].join(";");
  return [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
    `curl -fsSL --retry 3 -o clip.mp4 ${shellQuote(input.footageUrl)}`,
    `curl -fsSL --retry 3 -o hook.png ${shellQuote(input.overlayUrl)}`,
    `curl -fsSL --retry 3 -o logo.png ${shellQuote(input.logoUrl)}`,
    // Stills of the footage alone, before anything is laid over it.
    ...(input.frameUploads ?? []).flatMap((url, i, all) => [
      `T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4 | awk '{ printf "%.2f", $1 * ${((i + 0.5) / all.length).toFixed(3)} }')`,
      `ffmpeg -hide_banner -loglevel error -y -ss "$T" -i clip.mp4 -frames:v 1 -vf scale=720:-2 -q:v 3 still${i}.jpg`,
      `curl -fsS --retry 3 -X PUT -H 'Content-Type: image/jpeg' -H 'x-upsert: true' --data-binary @still${i}.jpg ${shellQuote(url)} >/dev/null`,
    ]),
    [
      "ffmpeg -hide_banner -loglevel error -y",
      "-i clip.mp4 -loop 1 -i hook.png -loop 1 -i logo.png",
      `-filter_complex ${shellQuote(filter)}`,
      // The footage's own sound, when it has one.
      `-map "[v]" -map "0:a?" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k -shortest -movflags +faststart out.mp4`,
    ].join(" "),
    `curl -fsS --retry 3 -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @out.mp4 ${shellQuote(input.uploadUrl)} >/dev/null`,
    `echo "COMPOSED $(stat -c %s out.mp4) $(ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4) $(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 out.mp4 | wc -l)"`,
  ].join("\n");
}

/** The sandbox's reply, read: the finished file's size, length and audio streams, or null when it did not finish. */
export function parseComposed(reply: string): { bytes: number; seconds: number; audio: number } | null {
  const m = /COMPOSED\s+(\d+)\s+([\d.]+)\s+(\d+)/.exec(reply);
  if (!m) return null;
  const bytes = Number(m[1]), seconds = Number(m[2]), audio = Number(m[3]);
  return bytes > 10_000 && seconds > 3 ? { bytes, seconds, audio } : null;
}

/**
 * The longest stretch of a client's own video handed to the video model as a
 * reference. Its references must be short (Moburst's videos, 20 to 80 seconds
 * long, were refused; LegaBot's 5-second Reels were taken).
 */
export const REFERENCE_SECONDS = 5;

/** Where the short reference cut from a client's video is kept, beside the video. */
export function referenceClipPath(videoPath: string): string {
  return `${videoPath.replace(/\.mp4$/i, "")}-ref${REFERENCE_SECONDS}s.mp4`;
}

export interface ClipInput {
  /** The client's own video. */
  sourceUrl: string;
  /** A signed upload URL for its short reference (Supabase Storage, PUT). */
  uploadUrl: string;
}

/**
 * The bash script that cuts REFERENCE_SECONDS from the middle of each video
 * (past any opening title or closing card), keeping its sound, and uploads
 * each cut. Its last line is "CLIPPED <count>" on success.
 */
export function clipScript(clips: ClipInput[]): string {
  const lines = [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
  ];
  clips.forEach((c, i) => {
    lines.push(
      `curl -fsSL --retry 3 -o src${i}.mp4 ${shellQuote(c.sourceUrl)}`,
      `D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 src${i}.mp4)`,
      `S=$(awk -v d="$D" 'BEGIN { s = d / 2 - ${REFERENCE_SECONDS / 2}; if (s < 0) s = 0; print s }')`,
      `ffmpeg -hide_banner -loglevel error -y -ss "$S" -i src${i}.mp4 -t ${REFERENCE_SECONDS} -map 0:v:0 -map "0:a?" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart clip${i}.mp4`,
      `curl -fsS --retry 3 -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @clip${i}.mp4 ${shellQuote(c.uploadUrl)} >/dev/null`,
    );
  });
  lines.push(`echo "CLIPPED ${clips.length}"`);
  return lines.join("\n");
}

/** Whether the sandbox's reply says every cut was made and uploaded. */
export function parseClipped(reply: string, count: number): boolean {
  const m = /CLIPPED\s+(\d+)/.exec(reply);
  return !!m && Number(m[1]) === count;
}

/** How many stills of the footage are read for stray writing. */
export const FOOTAGE_STILLS = 4;

/** The instruction for reading the footage's stills. */
export function footageTextPrompt(): string {
  return "These are stills from the footage of a social video, before any title or logo is laid over it. " +
    "Is there any writing anywhere in them: letters, words, numbers, labels on screens, dashboards or charts, signs, captions, logos or watermarks, however small or garbled? " +
    'Reply with JSON only: {"writing": true or false, "where": "where it is, or empty"}';
}

/** The answer about the footage's stills, or null when it gives none. */
export function parseFootageText(text: string): { writing: boolean; where: string } | null {
  const w = /"writing"\s*:\s*"?(true|false)"?/i.exec(text);
  if (!w) return null;
  const where = /"where"\s*:\s*"([\s\S]*?)"\s*}/.exec(text);
  return { writing: w[1].toLowerCase() === "true", where: where ? where[1] : "" };
}

