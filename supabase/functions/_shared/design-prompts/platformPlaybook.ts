// supabase/functions/_shared/design-prompts/platformPlaybook.ts
// Per-platform/format design best-practices that get injected into generation
// prompts. Edit here to change guidance globally without redeploying edge
// functions individually.

export interface PlatformPlaybookEntry {
  aspectRatio: "1:1" | "4:5" | "9:16" | "16:9" | "2:3" | "1.91:1";
  orientation: "square" | "portrait" | "vertical" | "horizontal";
  safeZones: string;                   // human description of safe zones
  scrollBehavior: string;              // how users encounter it
  firstFrameGuidance: string;          // what the first 1s/visible frame must do
  compositionGuidance: string;         // composition rules specific to this combo
  motionGuidance?: string;             // for video formats only
  textOverlayRules: string;            // when text overlays work, contrast rules
  avoid: string;                       // platform anti-patterns
}

type PlatformKey =
  | "instagram"
  | "tiktok"
  | "linkedin"
  | "facebook"
  | "youtube"
  | "twitter"
  | "default";

type FormatKey =
  | "carousel"
  | "reel"
  | "story"
  | "single_image"
  | "video"
  | "short"
  | "article"
  | "document"
  | "default";

// --- Instagram ---------------------------------------------------------------

const INSTAGRAM_CAROUSEL: PlatformPlaybookEntry = {
  aspectRatio: "4:5",
  orientation: "portrait",
  safeZones:
    "Keep critical content within the central 80% — Instagram crops to 1:1 in some views. " +
    "Bottom-right corner has a small UI overlay (the dots indicator).",
  scrollBehavior:
    "Users see the cover slide in feed and swipe through. " +
    "The cover must reward the swipe; interior slides build on a single visual system.",
  firstFrameGuidance:
    "Cover slide carries the hook — a single bold headline or visual idea. " +
    "Treat it like a magazine cover, not a slide title.",
  compositionGuidance:
    "Strong hierarchy on the cover; interior slides have shared system " +
    "(common type scale, color usage, grid). Each slide a complete thought.",
  textOverlayRules:
    "Cover slide can be type-led. Interior slides: headline + supporting line max. " +
    "16-20px equivalent body type is the floor — readers are on phones.",
  avoid:
    "Cluttered covers with multiple competing focal points. Walls of body text. " +
    "Logos in centre. Anything resembling a stock template.",
};

const INSTAGRAM_REEL: PlatformPlaybookEntry = {
  aspectRatio: "9:16",
  orientation: "vertical",
  safeZones:
    "Bottom 35% has UI clutter: caption, like/comment/share buttons on the right edge, " +
    "audio attribution at bottom. Top ~10% has profile/avatar overlay. " +
    "Keep key content in the central 55% vertical band.",
  scrollBehavior:
    "Algorithmically served full-screen. 1.5 seconds to hook before scroll-past.",
  firstFrameGuidance:
    "First frame is a thumbnail — must be visually striking before motion. " +
    "Hook visual or person's face dominant.",
  compositionGuidance:
    "Subject fills the frame. Movement enters the frame from outside or via subject motion. " +
    "Avoid empty quadrants in the safe zone.",
  motionGuidance:
    "Smooth, cinematic. Hook beat in first 1.5s. Color grade consistent. " +
    "Avoid quick cuts in the first 2 seconds — they read as nervous, not energetic.",
  textOverlayRules:
    "Top half of safe zone if any. Heavy weight, high-contrast. " +
    "Stagger reveals — never reveal the whole sentence at once.",
  avoid: "Centered text in the bottom third (UI overlay). 16:9 letterboxing. Tiny type.",
};

const INSTAGRAM_STORY: PlatformPlaybookEntry = {
  aspectRatio: "9:16",
  orientation: "vertical",
  safeZones:
    "Top 14% and bottom 20% have UI overlays (profile bar, reply input). " +
    "Keep content centered between them.",
  scrollBehavior:
    "Tap to advance, hold to pause, swipe to dismiss. ~5 seconds default.",
  firstFrameGuidance: "Hook in first 1 second; users tap through fast.",
  compositionGuidance:
    "Single bold visual. Strong contrast. One headline maximum. " +
    "Mood/atmosphere over information density.",
  textOverlayRules:
    "Centered safe zone only. Bold, large. Treat type like a chyron, not body copy.",
  avoid: "Information density. Text in the top 14% or bottom 20% UI zones.",
};

const INSTAGRAM_SINGLE: PlatformPlaybookEntry = {
  aspectRatio: "4:5",
  orientation: "portrait",
  safeZones: "Avoid the bottom 15% — gets clipped in some grid previews.",
  scrollBehavior: "Static feed scroll. Less than 1 second of attention without a hook.",
  firstFrameGuidance: "Editorial-quality single frame. Magazine page energy.",
  compositionGuidance:
    "One subject, one focal point, breathing room. Type if used is a quiet companion to imagery.",
  textOverlayRules: "Sparse. Headline-only. Position based on imagery's negative space.",
  avoid: "Stock-template look. Three-bullet layouts. Decorative shapes for their own sake.",
};

// --- TikTok ------------------------------------------------------------------

const TIKTOK_VIDEO: PlatformPlaybookEntry = {
  aspectRatio: "9:16",
  orientation: "vertical",
  safeZones:
    "Right edge has profile/like/comment/share buttons (~12% width). " +
    "Bottom 25% has caption, audio, username. Top 15% has search/discover bar. " +
    "Central window for critical content is roughly 70% width, 60% height.",
  scrollBehavior:
    "Algorithmically served full-screen. 1 second to hook. Sound usually ON.",
  firstFrameGuidance:
    "Hook in first frame. Either a face, a clear visual setup, or text that creates curiosity. " +
    "Movement starts immediately.",
  compositionGuidance:
    "Subject-centered, vertical-native framing. Lo-fi/authentic feel over polish. " +
    "Polished-looking content can feel ad-like and underperforms.",
  motionGuidance:
    "Quick cuts OK from the start. Trend-driven pacing. " +
    "Camera movement can be handheld-feel. Hook beat clear.",
  textOverlayRules:
    "Top center safe zone only. Sans-serif, heavy weight, white with black outline for contrast. " +
    "Read-aloud short — assume captions also visible.",
  avoid:
    "16:9 letterboxing. Stock-music vibes. Overproduced corporate look. " +
    "Type in the right or bottom safe zones.",
};

// --- LinkedIn ----------------------------------------------------------------

const LINKEDIN_SINGLE: PlatformPlaybookEntry = {
  aspectRatio: "1.91:1",
  orientation: "horizontal",
  safeZones:
    "If the post is shared from a link, the right 30% becomes a card stack — keep key content left-of-center.",
  scrollBehavior: "Feed scroll, often desktop. 2-3 seconds of attention possible.",
  firstFrameGuidance:
    "Editorial composition. Title-card or data-viz energy. Subdued, premium color treatment.",
  compositionGuidance:
    "Headline + one data point or single image. Generous whitespace. Sans-serif, refined.",
  textOverlayRules:
    "Headline overlay allowed. Conservative weight. Avoid stacks of bullets in image — put those in the caption.",
  avoid:
    "Loud colors. Stock business imagery (handshake, laptop+coffee). " +
    "Multiple competing CTAs.",
};

const LINKEDIN_CAROUSEL: PlatformPlaybookEntry = {
  aspectRatio: "1:1",
  orientation: "square",
  safeZones: "Center 90%. Bottom-right has 'X of Y' indicator.",
  scrollBehavior:
    "Desktop-heavy users. Swipe/click through. " +
    "First slide carries the hook; subsequent slides build a clear narrative.",
  firstFrameGuidance: "Magazine cover energy. Big idea + supporting line.",
  compositionGuidance:
    "Consistent type scale across slides. Whitespace generous. Subdued color story.",
  textOverlayRules:
    "Each slide one main idea + supporting line. Maximum 30-50 words per slide.",
  avoid: "Word walls. Random stock photos. Inconsistent slide layouts.",
};

const LINKEDIN_VIDEO: PlatformPlaybookEntry = {
  aspectRatio: "16:9",
  orientation: "horizontal",
  safeZones: "Bottom ~10% may have caption overlay. Otherwise full frame.",
  scrollBehavior: "Auto-plays muted. Captions ON by default for many users.",
  firstFrameGuidance:
    "Subject framing within first second. Avoid black opener — feed reads it as broken.",
  compositionGuidance: "Professional, restrained. Clear subject. Limited camera movement.",
  motionGuidance:
    "Smooth, deliberate. No quick cuts. Suitable pace for desktop viewing.",
  textOverlayRules: "Lower-third title overlay is standard. Keep captions readable.",
  avoid: "TikTok-style fast cuts. Underproduced look. Confusing transitions.",
};

const LINKEDIN_ARTICLE: PlatformPlaybookEntry = {
  aspectRatio: "1.91:1",
  orientation: "horizontal",
  safeZones: "Center 80%. Title visible on hover/click.",
  scrollBehavior: "Title-card preview in feed. Click-through to read.",
  firstFrameGuidance: "Hero image for an article. Editorial photography or single-idea graphic.",
  compositionGuidance: "Article-header energy. Title may overlay if contrast allows.",
  textOverlayRules: "Optional title overlay, restrained.",
  avoid: "Generic stock business shots.",
};

// --- Facebook ----------------------------------------------------------------

const FACEBOOK_VIDEO: PlatformPlaybookEntry = {
  aspectRatio: "1:1",
  orientation: "square",
  safeZones: "Square format optimized for the feed. Avoid edge details.",
  scrollBehavior: "Auto-plays muted. Sound ON requires click.",
  firstFrameGuidance: "Visual storytelling that works silent. Captions essential.",
  compositionGuidance:
    "Bold subject. Strong color. Movement that reads without audio.",
  motionGuidance: "Clear cuts, telegraphed motion. Captions baked in or auto-gen-readable.",
  textOverlayRules:
    "Captions baked in (no UI captions on Facebook). " +
    "Position centered or top safe zone.",
  avoid: "Sound-dependent content. Long quiet openers.",
};

const FACEBOOK_SINGLE: PlatformPlaybookEntry = {
  aspectRatio: "1.91:1",
  orientation: "horizontal",
  safeZones: "Center 85%. Some feeds crop 1:1.",
  scrollBehavior: "Feed scroll.",
  firstFrameGuidance: "Bold subject, clear focal point.",
  compositionGuidance: "Single idea. Type-led or imagery-led but not both.",
  textOverlayRules: "Maximum 20% of pixels as text (legacy ad rule; still good practice).",
  avoid: "Heavy text overlays.",
};

// --- YouTube -----------------------------------------------------------------

const YOUTUBE_SHORT: PlatformPlaybookEntry = {
  aspectRatio: "9:16",
  orientation: "vertical",
  safeZones:
    "Right edge ~12% has like/dislike/share/subscribe UI. " +
    "Bottom ~15% has title overlay and channel.",
  scrollBehavior: "Algorithmically served full-screen.",
  firstFrameGuidance: "Hook in first frame. Movement immediate.",
  compositionGuidance:
    "Subject-centered, vertical-native. Polished cinematic OK on YouTube " +
    "(unlike TikTok where overproduction hurts).",
  motionGuidance: "Cinematic camera moves. Dynamic lighting. Hook beat clear.",
  textOverlayRules: "Top safe zone. Heavy weight.",
  avoid: "Right-edge or bottom-15% type placement.",
};

const YOUTUBE_VIDEO: PlatformPlaybookEntry = {
  aspectRatio: "16:9",
  orientation: "horizontal",
  safeZones: "Bottom ~10% may have title/CC overlay.",
  scrollBehavior: "Click-through from thumbnails. High attention.",
  firstFrameGuidance:
    "Thumbnail-worthy first frame. Cinematic opening. Music/sound prominent.",
  compositionGuidance: "High production value. Dynamic. Cinematic lighting.",
  motionGuidance: "Cinematic camera movement. Smooth or stylized; intentional.",
  textOverlayRules: "Lower-third overlays standard. Title cards for transitions.",
  avoid: "Underproduced look. Static talking-head openers without context.",
};

// --- Twitter / X -------------------------------------------------------------

const TWITTER_SINGLE: PlatformPlaybookEntry = {
  aspectRatio: "16:9",
  orientation: "horizontal",
  safeZones: "Center 90%. Image may crop 2:1 in feed.",
  scrollBehavior: "Feed scroll. Click expands.",
  firstFrameGuidance: "Quick-read concept. Headline + small image.",
  compositionGuidance: "Single idea. Strong contrast. Quick decode.",
  textOverlayRules: "Type-led OK. High contrast.",
  avoid: "Decorative shapes without purpose.",
};

const TWITTER_VIDEO: PlatformPlaybookEntry = {
  aspectRatio: "16:9",
  orientation: "horizontal",
  safeZones: "Center 90%.",
  scrollBehavior: "Auto-plays muted.",
  firstFrameGuidance: "Strong hook frame; sound-off readable.",
  compositionGuidance: "Quick decode. Bold subject.",
  motionGuidance: "Movement readable without sound.",
  textOverlayRules: "Captions baked in.",
  avoid: "Sound-dependent content.",
};

// --- Global default ----------------------------------------------------------

const GLOBAL_DEFAULT: PlatformPlaybookEntry = {
  aspectRatio: "1:1",
  orientation: "square",
  safeZones: "Keep critical content within central 85%.",
  scrollBehavior: "Feed scroll context.",
  firstFrameGuidance: "Strong hook frame.",
  compositionGuidance: "Single focal point. Strong hierarchy.",
  textOverlayRules: "Sparse, high contrast.",
  avoid: "Stock-template look.",
};

const PLAYBOOK: Record<PlatformKey, Partial<Record<FormatKey, PlatformPlaybookEntry>>> = {
  instagram: {
    carousel: INSTAGRAM_CAROUSEL,
    reel: INSTAGRAM_REEL,
    story: INSTAGRAM_STORY,
    single_image: INSTAGRAM_SINGLE,
    default: INSTAGRAM_REEL,           // IG is video-first → reel
  },
  tiktok: {
    video: TIKTOK_VIDEO,
    short: TIKTOK_VIDEO,               // alias — TikTok shorts use same playbook as TikTok video
    default: TIKTOK_VIDEO,
  },
  linkedin: {
    single_image: LINKEDIN_SINGLE,
    carousel: LINKEDIN_CAROUSEL,
    video: LINKEDIN_VIDEO,
    article: LINKEDIN_ARTICLE,
    default: LINKEDIN_SINGLE,          // LinkedIn → single image (1.91:1 landscape)
  },
  facebook: {
    video: FACEBOOK_VIDEO,
    single_image: FACEBOOK_SINGLE,
    default: FACEBOOK_SINGLE,
  },
  youtube: {
    short: YOUTUBE_SHORT,
    video: YOUTUBE_VIDEO,
    default: YOUTUBE_VIDEO,            // YouTube → 16:9 video
  },
  twitter: {
    single_image: TWITTER_SINGLE,
    video: TWITTER_VIDEO,
    default: TWITTER_SINGLE,
  },
  default: {
    default: GLOBAL_DEFAULT,
  },
};

const PLATFORM_NORMALIZE: Record<string, PlatformKey> = {
  instagram: "instagram", ig: "instagram",
  tiktok: "tiktok", tt: "tiktok",
  linkedin: "linkedin", li: "linkedin",
  facebook: "facebook", fb: "facebook", meta: "facebook",
  youtube: "youtube", yt: "youtube",
  twitter: "twitter", x: "twitter",
};

const FORMAT_NORMALIZE: Array<[RegExp, FormatKey]> = [
  [/carousel|album|swipe|slideshow|gallery|multi-image/i, "carousel"],
  [/story|stories/i, "story"],
  [/reel/i, "reel"],
  [/short/i, "short"],
  [/article|document|pdf/i, "article"],
  [/video|clip/i, "video"],
  [/image|photo|single|static/i, "single_image"],
];

function normalizePlatform(p?: string): PlatformKey {
  if (!p) return "default";
  return PLATFORM_NORMALIZE[p.toLowerCase()] ?? "default";
}

function normalizeFormat(f?: string): FormatKey {
  if (!f) return "default";
  for (const [pattern, key] of FORMAT_NORMALIZE) {
    if (pattern.test(f)) return key;
  }
  return "default";
}

/**
 * Look up the playbook entry for a platform+format combo, with sensible
 * fallbacks. Always returns a valid entry.
 */
export function getPlaybookEntry(platform?: string, format?: string): PlatformPlaybookEntry {
  const platformKey = normalizePlatform(platform);
  const formatKey = normalizeFormat(format);
  const platformBook = PLAYBOOK[platformKey];
  const entry =
    platformBook?.[formatKey] ??
    platformBook?.["default"] ??
    PLAYBOOK.default!.default!;
  return entry;
}

/**
 * Render the playbook entry as a labelled markdown section for inclusion in a
 * generation prompt.
 */
export function renderPlaybookSection(entry: PlatformPlaybookEntry, platform?: string, format?: string): string {
  const lines = [
    `## Platform & format playbook — ${platform || "general"} ${format || ""}`.trim(),
    `Aspect: ${entry.aspectRatio} (${entry.orientation}).`,
    `Safe zones: ${entry.safeZones}`,
    `Scroll/encounter: ${entry.scrollBehavior}`,
    `First frame: ${entry.firstFrameGuidance}`,
    `Composition: ${entry.compositionGuidance}`,
  ];
  if (entry.motionGuidance) lines.push(`Motion: ${entry.motionGuidance}`);
  lines.push(`Text overlay rules: ${entry.textOverlayRules}`);
  lines.push(`Avoid: ${entry.avoid}`);
  return lines.join("\n");
}
