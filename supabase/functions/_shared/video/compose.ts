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

/** The closing logo fades in over this long, this long before the end. */
export const LOGO_END = { fade: 0.5, lead: 1.6 } as const;

/**
 * Where the logo file sits in a new video, as in the client's own videos: at
 * one spot of the frame throughout, or centered over the close. Margins keep
 * it clear of the platform's own buttons and captions.
 */
export function videoLogoBox(at: string, widthShare: number, logoAspect: number): LogoBox & { end: boolean } {
  const W = VIDEO_SIZE.width, H = VIDEO_SIZE.height;
  const width = Math.round(W * Math.min(0.6, Math.max(0.08, widthShare)));
  const height = Math.round(width / Math.max(0.2, logoAspect));
  if (at === "end") return { x: Math.round((W - width) / 2), y: Math.round((H - height) / 2), width, end: true };
  const [v, h] = at.split("-");
  const x = h === "left" ? Math.round(W * 0.06) : h === "right" ? W - width - Math.round(W * 0.06) : Math.round((W - width) / 2);
  const y = v === "bottom" ? Math.round(H * 0.84) - height : Math.round(H * 0.06);
  return { x, y, width, end: false };
}

/** Where the hook's lettering sits on its transparent layer, in that layer's pixels. */
export interface HookBox { x: number; y: number; width: number; height: number }

/**
 * Where the hook goes on the frame (VIDEO_SIZE pixels): the planned place,
 * read from the plan's description of how the hook looks. The lettering is
 * placed exactly, like the logo file, rather than wherever the image model
 * drew it on its layer (it drew a "lower third" hook across a speaker's face).
 * The bottom fifth of the frame is left to the platform's own captions and
 * buttons; a hook at the top sits below the logo.
 */
export function hookPlacement(box: HookBox, layer: { width: number; height: number }, textStyle: string, logoBottom: number): { x: number; y: number; width: number; height: number } {
  const k = VIDEO_SIZE.width / layer.width;
  let width = Math.round(box.width * k), height = Math.round(box.height * k);
  const maxWidth = Math.round(VIDEO_SIZE.width * 0.9);
  if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
  const x = Math.round((VIDEO_SIZE.width - width) / 2);
  const style = textStyle.toLowerCase();
  const y = /lower third|bottom|lower part|lower half/.test(style)
    ? Math.round(VIDEO_SIZE.height * 0.78) - height
    : /\btop\b|upper/.test(style)
      ? Math.max(Math.round(logoBottom + VIDEO_SIZE.height * 0.03), Math.round(VIDEO_SIZE.height * 0.12))
      : Math.round((VIDEO_SIZE.height - height) / 2);
  return { x, y, width, height };
}

export interface ComposeInput {
  footageUrl: string;
  /** The hook on a transparent PNG, the size of the frame; none when the client's videos carry no text over the footage. */
  overlayUrl?: string;
  /** The hook's lettering on that layer, and where it goes on the frame; without them the layer covers the frame as drawn. */
  hook?: { crop: HookBox; at: { x: number; y: number; width: number } };
  /** The client's logo file; none when the client's videos show no logo over the footage. */
  logoUrl?: string;
  /** Where the logo file sits, in VIDEO_SIZE pixels; with end, only over the close. */
  logo?: LogoBox & { end?: boolean };
  /** A signed upload URL for the finished MP4 (Supabase Storage, PUT). */
  uploadUrl: string;
  /** Signed upload URLs for stills of the footage alone, spread across it, read for stray writing. */
  frameUploads?: string[];
  /** The footage as first made, whose sound is kept when its picture was cleaned of writing. */
  audioUrl?: string;
  /** Captions of a filmed clip's speech, typeset in the client's caption font (an ASS file, base64). */
  captions?: { assB64: string; fontUrl: string };
  /** The client's own end card, cut from the end of one of its published videos and played after the clip. */
  endCard?: { url: string; seconds: number };
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
  const inputs = ["-i clip.mp4"];
  let next = 1;
  const hookIn = input.overlayUrl ? next++ : -1;
  if (input.overlayUrl) inputs.push("-loop 1 -i hook.png");
  const logoIn = input.logoUrl && input.logo ? next++ : -1;
  if (logoIn >= 0) inputs.push("-loop 1 -i logo.png");
  const soundIn = input.audioUrl ? next++ : -1;
  if (input.audioUrl) inputs.push("-i sound.mp4");

  const filter = [`[0:v]${FIT}${input.captions ? ",ass=captions.ass:fontsdir=fonts" : ""},format=yuv420p[base]`];
  let last = "base";
  if (hookIn >= 0) {
    filter.push(input.hook
      ? `[${hookIn}:v]crop=${input.hook.crop.width}:${input.hook.crop.height}:${input.hook.crop.x}:${input.hook.crop.y},scale=${input.hook.at.width}:-1:flags=lanczos,format=rgba,fade=t=in:st=0:d=${TIMING.fadeIn}:alpha=1[hook]`
      : `[${hookIn}:v]scale=${VIDEO_SIZE.width}:${VIDEO_SIZE.height},format=rgba,fade=t=in:st=0:d=${TIMING.fadeIn}:alpha=1[hook]`);
    // The text leaves as a closing logo arrives.
    filter.push(`[${last}][hook]overlay=${input.hook ? `${input.hook.at.x}:${input.hook.at.y}` : "0:0"}:shortest=1${input.logo?.end && input.logoUrl ? ":enable='lt(t,@END@)'" : ""}[v1]`);
    last = "v1";
  }
  if (logoIn >= 0 && input.logo) {
    const closing = input.logo.end ? `,fade=t=in:st=@END@:d=${LOGO_END.fade}:alpha=1` : "";
    filter.push(`[${logoIn}:v]scale=${Math.round(input.logo.width)}:-1:flags=lanczos,format=rgba${closing}[logo]`);
    filter.push(`[${last}][logo]overlay=${Math.round(input.logo.x)}:${Math.round(input.logo.y)}:shortest=1${input.logo.end ? ":enable='gte(t,@END@)'" : ""}[v2]`);
    last = "v2";
  }
  filter.push(`[${last}]format=yuv420p[v]`);
  // The end card follows the clip, with its own sound (or silence); added by the script only when it is vertical.
  const endFilter = input.endCard
    ? `;[v]setsar=1[vm];[${soundIn >= 0 ? soundIn : 0}:a]aformat=sample_rates=48000:channel_layouts=stereo[am];[@EC@:v]${FIT},format=yuv420p[ecv];[@ECA@]aformat=sample_rates=48000:channel_layouts=stereo[eca];[vm][am][ecv][eca]concat=n=2:v=1:a=1[vout][aout]`
    : "";

  return [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
    `curl -fsSL --retry 3 -o clip.mp4 ${shellQuote(input.footageUrl)}`,
    ...(input.overlayUrl ? [`curl -fsSL --retry 3 -o hook.png ${shellQuote(input.overlayUrl)}`] : []),
    ...(logoIn >= 0 && input.logoUrl ? [`curl -fsSL --retry 3 -o logo.png ${shellQuote(input.logoUrl)}`] : []),
    ...(input.audioUrl ? [`curl -fsSL --retry 3 -o sound.mp4 ${shellQuote(input.audioUrl)}`] : []),
    // The caption font (kept in the app's storage: the sandbox reaches nothing else), and the captions.
    ...(input.captions ? [
      "mkdir -p fonts",
      `curl -fsSL --retry 3 -o fonts/caption.ttf ${shellQuote(input.captions.fontUrl)}`,
      `printf '%s' ${shellQuote(input.captions.assB64)} | base64 -d > captions.ass`,
    ] : []),
    // The end card: the last seconds of one of the client's own videos, used only when that video is vertical.
    ...(input.endCard ? [
      `curl -fsSL --retry 3 -o endsrc.mp4 ${shellQuote(input.endCard.url)}`,
      `EC_W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 endsrc.mp4); EC_H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 endsrc.mp4)`,
      `if [ "$EC_H" -gt "$EC_W" ]; then ffmpeg -hide_banner -loglevel error -y -sseof -${input.endCard.seconds.toFixed(1)} -i endsrc.mp4 -t ${input.endCard.seconds.toFixed(1)} -c:v libx264 -preset veryfast -crf 16 -c:a aac endcard.mp4 && EC=1; else EC=0; fi`,
      `if [ "\${EC:-0}" = 1 ] && [ "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 endcard.mp4 | wc -l)" -lt 1 ]; then EC_SILENT=1; fi`,
    ] : []),
    // Stills of the footage alone, before anything is laid over it.
    ...(input.frameUploads ?? []).flatMap((url, i, all) => [
      `T=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4 | awk '{ printf "%.2f", $1 * ${((i + 0.5) / all.length).toFixed(3)} }')`,
      `ffmpeg -hide_banner -loglevel error -y -ss "$T" -i clip.mp4 -frames:v 1 -vf scale=720:-2 -q:v 3 still${i}.jpg`,
      `curl -fsS --retry 3 -X PUT -H 'Content-Type: image/jpeg' -H 'x-upsert: true' --data-binary @still${i}.jpg ${shellQuote(url)} >/dev/null`,
    ]),
    // A closing logo starts a moment before the footage ends.
    ...(input.logo?.end ? [`END=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4 | awk '{ s = $1 - ${LOGO_END.lead}; printf "%.2f", (s < 0 ? 0 : s) }')`] : []),
    `FILTER=${shellQuote(filter.join(";"))}`,
    ...(input.logo?.end ? ['FILTER="${FILTER//@END@/$END}"'] : []),
    ...(input.endCard ? [
      // With a vertical end card, the clip and the card are joined; otherwise the clip stands alone.
      `if [ "\${EC:-0}" = 1 ]; then ECIN="-i endcard.mp4"; ECN=${inputs.length}; if [ "\${EC_SILENT:-0}" = 1 ]; then ECIN="$ECIN -f lavfi -t ${input.endCard.seconds.toFixed(1)} -i anullsrc=r=48000:cl=stereo"; ECA="$((ECN + 1)):a"; else ECA="$ECN:a"; fi; END_F=${shellQuote(endFilter)}; END_F="\${END_F//@EC@/$ECN}"; FILTER="$FILTER\${END_F//@ECA@/$ECA}"; MAPS='-map [vout] -map [aout]'; else ECIN=""; MAPS='-map [v] -map ${soundIn >= 0 ? soundIn : 0}:a?'; fi`,
    ] : [`ECIN=""; MAPS='-map [v] -map ${soundIn >= 0 ? soundIn : 0}:a?'`]),
    // The maps hold brackets; no file name may stand in for them.
    "set -f",
    [
      "ffmpeg -hide_banner -loglevel error -y",
      inputs.join(" "),
      "$ECIN",
      `-filter_complex "$FILTER"`,
      // The footage's own sound, when it has one.
      `$MAPS -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 160k${input.endCard ? "" : " -shortest"} -movflags +faststart out.mp4`,
    ].join(" "),
    `curl -fsS --retry 3 -X PUT -H 'Content-Type: video/mp4' -H 'x-upsert: true' --data-binary @out.mp4 ${shellQuote(input.uploadUrl)} >/dev/null`,
    `echo "COMPOSED $(stat -c %s out.mp4) $(ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4) $(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 out.mp4 | wc -l)"`,
  ].join("\n");
}

/** Stills taken from each of a client's own videos, to learn how its videos look. */
export const STYLE_FRAMES = 8;

/**
 * The bash script that takes STYLE_FRAMES stills, spread evenly, from each of
 * the client's own videos and uploads each. Its last line is "FRAMES <count>".
 */
export function framesScript(videos: Array<{ sourceUrl: string; uploads: string[] }>): string {
  const lines = [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
  ];
  let count = 0;
  videos.forEach((v, i) => {
    lines.push(`curl -fsSL --retry 3 -o v${i}.mp4 ${shellQuote(v.sourceUrl)}`, `D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 v${i}.mp4)`);
    v.uploads.forEach((url, j) => {
      lines.push(
        `T=$(awk -v d="$D" 'BEGIN { printf "%.2f", d * ${((j + 0.5) / v.uploads.length).toFixed(4)} }')`,
        `ffmpeg -hide_banner -loglevel error -y -ss "$T" -i v${i}.mp4 -frames:v 1 -vf scale=540:-2 -q:v 4 f${i}_${j}.jpg`,
        `curl -fsS --retry 3 -X PUT -H 'Content-Type: image/jpeg' -H 'x-upsert: true' --data-binary @f${i}_${j}.jpg ${shellQuote(url)} >/dev/null`,
      );
      count++;
    });
  });
  lines.push(`echo "FRAMES ${count}"`);
  return lines.join("\n");
}

/** Whether the sandbox's reply says every still was taken and uploaded. */
export function parseFrames(reply: string, count: number): boolean {
  const m = /FRAMES\s+(\d+)/.exec(reply);
  return !!m && Number(m[1]) === count;
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
export function footageTextPrompt(allowed: string[] = []): string {
  const keep = allowed.length
    ? `These names and numbers belong to the brand and may appear in the scenes, spelled exactly like this: ${allowed.map((w) => `"${w}"`).join(", ")}. They do not count, also where framing, folds, motion blur or distance soften or hide part of them. Count everything else: any other writing, a version of those names whose letters can be read and are wrong, and any logo, stripe, swoosh or emblem of a real brand. `
    : "";
  return "These are stills from the footage of a social video, before any title or logo is laid over it. " +
    "Is there any writing anywhere in them: letters, words, numbers, labels on screens, dashboards or charts, signs, captions, logos or watermarks, however small or garbled? " + keep +
    'Reply with JSON only: {"writing": true or false, "where": "what must go and where it is, or empty"}';
}

/** The answer about the footage's stills, or null when it gives none. */
export function parseFootageText(text: string): { writing: boolean; where: string } | null {
  const w = /"writing"\s*:\s*"?(true|false)"?/i.exec(text);
  if (!w) return null;
  const where = /"where"\s*:\s*"([\s\S]*?)"\s*}/.exec(text);
  return { writing: w[1].toLowerCase() === "true", where: where ? where[1] : "" };
}

/** The instruction for cleaning writing out of footage, keeping everything else (and the brand's own scene names). */
export function cleanFootagePrompt(allowed: string[] = [], found = ""): string {
  const keep = "Where each was, continue the plain surface it was on. Keep everything else exactly as it is: the subjects, the motion, the camera, the light, the colors, the sharpness and the timing.";
  if (allowed.length) {
    return `Remove these from this video: ${found || "any writing that is misspelled or garbled"}. Remove any logo, stripe, swoosh or emblem of a real brand too, on clothing, shoes and balls. ` +
      `Keep these names exactly where and as they are: ${allowed.map((w) => `"${w}"`).join(", ")}. ${keep}`;
  }
  return "Remove every piece of writing from this video: letters, words, numbers, logos, brand marks, stripes or emblems of real brands, signs, boards, labels and printing, on any surface, including clothing, shoes, balls, walls, boards and screens. " + keep;
}


/** A spoken word and when it is said, in seconds from the clip's start. */
export interface SpokenWord { word: string; start: number; end: number }

/**
 * The script that takes a filmed clip's sound for transcription: mono, 16 kHz,
 * small enough to send on. Its last line is "AUDIO <bytes> <seconds>".
 */
export function audioScript(input: { clipUrl: string; uploadUrl: string }): string {
  return [
    "set -euo pipefail",
    "command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)",
    "W=$(mktemp -d) && cd \"$W\"",
    `curl -fsSL --retry 3 -o clip ${shellQuote(input.clipUrl)}`,
    "ffmpeg -hide_banner -loglevel error -y -i clip -vn -ac 1 -ar 16000 -b:a 48k audio.mp3",
    `curl -fsS --retry 3 -X PUT -H 'Content-Type: audio/mpeg' -H 'x-upsert: true' --data-binary @audio.mp3 ${shellQuote(input.uploadUrl)} >/dev/null`,
    `echo "AUDIO $(stat -c %s audio.mp3) $(ffprobe -v error -show_entries format=duration -of csv=p=0 clip)"`,
  ].join("\n");
}

/** The audio script's answer: the stored sound and the clip's length, or null when it did not finish. */
export function parseAudio(reply: string): { bytes: number; seconds: number } | null {
  const m = /AUDIO (\d+) ([\d.]+)/.exec(reply);
  return m ? { bytes: Number(m[1]), seconds: Number(m[2]) } : null;
}

/** "#rrggbb" as an ASS colour (&HAABBGGRR). */
function assColor(hex: string, alpha = "00"): string {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? "ffffff";
  return `&H${alpha}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

/** Text safe inside an ASS line. */
function assText(t: string): string {
  return t.replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
}

/** How heavy the caption type is, from how the client's captions look. */
export function captionWeight(style: string): number {
  const s = style.toLowerCase();
  return /black|heavy|extra ?bold|ultra/.test(s) ? 900 : /semi ?bold|medium/.test(s) ? 600 : /bold|thick|chunky/.test(s) ? 800 : 700;
}

/**
 * Captions of a filmed clip's speech, as an ASS file for a 1080x1920 frame,
 * typeset the way the client's own videos caption speech: a few words at a
 * time (or a line), in its caption colour, the spoken word lit in its
 * highlight colour when its videos do that.
 */
/**
 * The family name a Google Fonts file of this weight carries: regular and bold
 * are styles of the family, every other weight is a family of its own
 * ("Montserrat ExtraBold"). The captions must name it exactly or the type falls back.
 */
export function captionFontName(family: string, weight: number): { name: string; bold: boolean } {
  const named: Record<number, string> = { 100: "Thin", 200: "ExtraLight", 300: "Light", 500: "Medium", 600: "SemiBold", 800: "ExtraBold", 900: "Black" };
  return weight === 700 ? { name: family, bold: true } : weight === 400 ? { name: family, bold: false } : { name: `${family} ${named[weight] ?? "Bold"}`, bold: false };
}

export function captionsAss(words: SpokenWord[], f: { captions: "none" | "words" | "lines"; caption_style: string; caption_font: string; caption_color: string; highlight_color: string; caption_position: string; caption_y?: number }, breaks: number[] = []): string {
  const style = f.caption_style.toLowerCase();
  const upper = /upper ?case|all caps|capitals/.test(style);
  const perChunk = f.captions === "lines" ? 6 : 3;
  const chunks: SpokenWord[][] = [];
  let current: SpokenWord[] = [];
  for (const w of words.filter((x) => assText(x.word))) {
    const gap = current.length ? w.start - current[current.length - 1].end : 0;
    // A caption never runs across a sentence: word timings carry no punctuation, so the transcript's own segments mark where sentences start.
    const newSentence = breaks.some((b) => b > current[0]?.start + 0.01 && b <= w.start + 0.01);
    if (current.length && (current.length >= perChunk || gap > 0.6 || newSentence || /[.!?]$/.test(current[current.length - 1].word))) { chunks.push(current); current = []; }
    current.push(w);
  }
  if (current.length) chunks.push(current);
  const size = f.captions === "lines" ? 62 : 78;
  // Where the client's own captions sit, when measured; else from where they are said to sit.
  const [alignment, marginV] = typeof f.caption_y === "number"
    ? [2, Math.max(60, Math.round((1 - f.caption_y) * 1920 - size * 0.6))]
    : f.caption_position === "top" ? [8, 300] : f.caption_position === "middle" ? [5, 0] : f.caption_position === "bottom" ? [2, 330] : [2, 420];
  const font = captionFontName(f.caption_font, captionWeight(f.caption_style));
  const t = (x: number) => {
    const cs = Math.max(0, Math.round(x * 100));
    const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100), c = cs % 100;
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  };
  const say = (w: string) => (upper ? assText(w).toUpperCase() : assText(w));
  const lines: string[] = [];
  for (const chunk of chunks) {
    if (f.highlight_color && f.captions === "words") {
      // The chunk stays on screen; the word being said lights up.
      chunk.forEach((w, i) => {
        const end = i + 1 < chunk.length ? chunk[i + 1].start : w.end;
        // An override colour closes with "&" ({\\c&HBBGGRR&}); without it the colour is ignored.
        const text = chunk.map((x, j) => (j === i ? `{\\c${assColor(f.highlight_color)}&}${say(x.word)}{\\c${assColor(f.caption_color)}&}` : say(x.word))).join(" ");
        lines.push(`Dialogue: 0,${t(w.start)},${t(Math.max(end, w.start + 0.05))},Cap,,0,0,0,,${text}`);
      });
    } else {
      lines.push(`Dialogue: 0,${t(chunk[0].start)},${t(chunk[chunk.length - 1].end)},Cap,,0,0,0,,${chunk.map((x) => say(x.word)).join(" ")}`);
    }
  }
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${font.name},${size},${assColor(f.caption_color)},${assColor(f.caption_color)},&H00000000,&H78000000,${font.bold ? -1 : 0},0,0,0,100,100,0,0,1,${/no (outline|stroke|shadow)/.test(style) ? 0 : 4},${/shadow/.test(style) ? 3 : 1},${alignment},90,90,${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...lines,
    "",
  ].join("\n");
}
