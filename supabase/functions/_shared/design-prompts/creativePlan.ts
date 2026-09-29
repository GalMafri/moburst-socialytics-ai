/** A reference supplies a visual language, never a reusable finished advertisement. */
export interface CreativeFrame {
  headline: string;
  subject: string;
  composition: string;
  action: string;
  reference_indices: number[];
}
export interface CreativePlan {
  brand_system: string;
  frames: CreativeFrame[];
  logo?: {reference_index:number;x:number;y:number;width:number;height:number};
  caption_style?: {color:string;surface:string;font_weight:number};
}
const concise = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function parseCreativePlan(value: unknown, count: number, references: number, video = false): CreativePlan {
  const v = value as CreativePlan;
  if (!v || !concise(v.brand_system, 2500) || !Array.isArray(v.frames) || v.frames.length !== count) throw new Error('The creative plan was incomplete.');
  const subjects = new Set<string>(), compositions = new Set<string>();
  for (const f of v.frames) {
    if (!concise(f.headline, 120) || f.headline.trim().split(/\s+/).length > (video ? 9 : 14) || !concise(f.subject, 700) || !concise(f.composition, 900) || !concise(f.action, 700)) throw new Error('Each scene needs a concise message and a complete visual direction.');
    if (!Array.isArray(f.reference_indices) || f.reference_indices.length < 2 || f.reference_indices.length > 3 || new Set(f.reference_indices).size !== f.reference_indices.length || f.reference_indices.some(i => !Number.isInteger(i) || i < 0 || i >= references)) throw new Error('Each design must be grounded in two or three owned references.');
    subjects.add(f.subject.toLowerCase().trim()); compositions.add(f.composition.toLowerCase().trim());
  }
  if (subjects.size !== count || (count > 1 && compositions.size < Math.min(count, 3))) throw new Error('The plan repeats the same subject or composition.');
  if (video) {
    const l=v.logo, c=v.caption_style;
    if(!l||!Number.isInteger(l.reference_index)||l.reference_index<0||l.reference_index>=references||!['x','y','width','height'].every(k=>Number.isFinite(l[k as keyof typeof l]))||l.x<0||l.y<0||l.width<=0||l.height<=0||l.x+l.width>1||l.y+l.height>1||l.width*l.height>0.08) throw new Error('The authentic logo could not be located in the client references.');
    if(!c||!/^#[0-9a-f]{6}$/i.test(c.color)||!/^#[0-9a-f]{6}$/i.test(c.surface)||![400,700].includes(c.font_weight)) throw new Error('The reference typography could not be identified.');
  }
  return v;
}
export function creativeImagePrompt(plan: CreativePlan, index: number, correction = ''): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  return [
    'Create ONE new finished client social graphic. The attached images are real published client references. Study their actual visual treatment, typography, palette, spacing and authentic logo. They are visual evidence, not canvases to repaint.',
    `Reference-backed brand system: ${plan.brand_system}`,
    `New subject for this post: ${f.subject}`,
    `Composition for this particular design: ${f.composition}`,
    `Exact headline: ${JSON.stringify(f.headline)}. This and the authentic client logo are the only visible words. Preserve spelling and sentence case.`,
    'Create new imagery appropriate to this message. Never reuse a reference photograph, face, campaign prop, product, quote or headline. Never just change the text on a reference. Retain the real brand identity and design treatment, while changing the subject, visual hierarchy and arrangement as directed. Do not invent people, endorsements, statistics or product claims.',
    'One edge-to-edge composition, no contact sheet, mock social interface, slide counter or extra captions. Match the authentic logo in the supplied images precisely; never invent a replacement mark.',
    correction ? `Correct the previous attempt: ${correction.slice(0, 1600)}` : '',
  ].filter(Boolean).join('\n\n');
}
export function creativeVideoPrompt(plan: CreativePlan): string {
  return [
    'Produce a 12-second film with three distinct shots and purposeful subject movement. The attached real client posts are STYLE REFERENCES only. Do not animate those cards, hold a poster, zoom a still, or turn them into a slideshow. Create a new moving scene for each shot.',
    `Use the photographic/illustration treatment, palette and lighting visibly supported by these references: ${plan.brand_system}`,
    ...plan.frames.map((f, i) => `SHOT ${i + 1}, ${i * 4}-${(i + 1) * 4}s: ${f.subject}. ACTION: ${f.action}. CAMERA/COMPOSITION: ${f.composition}.`),
    'Cut between the three different shots at 4 and 8 seconds. Show visible action throughout each shot, with depth and temporal progression. No repeated opening frame. No static headline cards, frozen posters or crossfades between still images.',
    'Render no lettering, subtitles, numbers, logos, watermarks, interfaces or text containers. The application adds exact timed typography and the authentic client logo afterwards. Keep the lower quarter relatively calm for that typography. No invented claims, portraits or testimonials.',
  ].join('\n\n');
}
