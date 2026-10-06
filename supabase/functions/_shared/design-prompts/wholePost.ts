// The whole-post path: the image model designs the finished post in one
// picture from the client's own published posts (and the client's logo file
// when there is one), with the approved headline rendered as part of the
// design. Nothing is rebuilt in code afterwards; code only checks the result
// (exact words, one authentic logo, legibility, brand match) and asks for a
// corrected attempt when a check fails.
import type { CreativePlan } from './creativePlan.ts';
import type { PlatformDesignSpec } from './aspect.ts';
import type { DesignVerdict } from './correction.ts';

export function counterText(mode: string, index: number, count: number): string {
  if (mode !== 'carousel' || count < 2) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(index + 1)} / ${pad(count)}`;
}

/** The only words allowed in the finished picture (besides the logo). */
export function wholePostExpectedText(plan: CreativePlan, index: number, mode: string): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  const counter = counterText(mode, index, plan.frames.length);
  return counter ? `${f.headline} ${counter}` : f.headline;
}

export function wholePostPrompt(plan: CreativePlan, index: number, spec: PlatformDesignSpec | undefined, mode: string, hasLogoFile: boolean, correction = ''): string {
  const f = plan.frames[index];
  if (!f) throw new Error('That scene is not in the creative plan.');
  const counter = counterText(mode, index, plan.frames.length);
  const layout = f.layout;
  const logoSource = hasLogoFile ? 'the last attached image is the brand\'s logo file: place it exactly as it is, same colours and proportions, do not redraw or restyle it' : 'place the brand\'s logo exactly as it appears in the attached posts, same colours and proportions, do not redraw or restyle it';
  return [
    spec ? spec.note : '',
    `Design a new ${mode === 'carousel' ? 'carousel slide' : 'social post'} for this brand. The attached images are the brand's own published posts. Match their visual language exactly: the palette and how much of the surface each colour covers, the typography style and weights, the headline surfaces they use (cards, panels, pills, bands), their frames and borders, the light, materials and the way hero objects are rendered, and where the logo sits and how large it is.`,
    `Recurring devices observed in these posts: ${plan.brand_system}`,
    'Compose ONE finished picture, designed the way these posts are designed, not a background with a text box on it: the hero scene runs behind and in front of the headline surface, one element overlaps an edge of it, and the picture has depth. The hero is a concrete concept for this message, rendered with the same craft as the references.',
    `Hero concept for this post: ${f.subject}`,
    layout ? `Hierarchy, taken from the brand's own post: headline ${layout.headline_position}, hero ${layout.subject_position}, logo ${layout.logo_position}.` : `Arrangement: ${f.composition}`,
    `Render this text exactly, with this spelling and nothing added or missing: "${f.headline}"${f.emphasis ? `, with the words "${f.emphasis}" set in the brand's emphasis treatment (bold or the accent colour, as the posts do)` : ''}.${counter ? ` Add the small slide counter "${counter}" where the brand's carousel posts place it.` : ''} No other text anywhere: no captions, labels, interface, watermarks, lettering on objects.`,
    `Logo: ${logoSource}; exactly one logo.`,
    'Build a new scene in the brand\'s language: do not copy a reference\'s photograph, person, product, campaign text or arrangement. No invented people, statistics, interfaces or claims.',
    correction ? `Correct the previous attempt: ${correction.slice(0, 1600)}` : '',
  ].filter(Boolean).join('\n\n');
}

/** What to tell the model when the review of a finished picture fails. */
export function wholePostCorrection(v: DesignVerdict, expectedText: string): string {
  const notes: string[] = [];
  if (v.has_unapproved_text || v.has_garbled_text) notes.push(`The text was wrong, misspelled, clipped or had extra words. Render exactly this text and nothing else: "${expectedText}".`);
  if (v.has_logo) notes.push('The logo was invented, distorted, doubled or missing. Place the brand\'s logo once, exactly as in the attached logo file or posts.');
  if (v.off_brand) notes.push('The picture drifted from the brand\'s own posts: match their palette, typography, surfaces, frames, light and rendering craft, and compose it as one picture with depth.');
  if (v.has_hex_codes) notes.push('Do not render colour codes or notation.');
  if (!notes.length && v.reason) notes.push(v.reason.slice(0, 400));
  return notes.join(' ');
}

/** The reviewer's brief for a finished post. It is told what is a defect and what is not, so good designs are not sent back. */
export function wholePostQuestion(expectedText: string, hasLogoFile: boolean, direction?: string): string {
  return `You are reviewing a FINISHED social post designed for a brand. The REAL CLIENT REFERENCES are the brand's own published posts${hasLogoFile ? ', and the last reference is the brand\'s logo file' : ''}. The CANDIDATE is the new design.
Look carefully before judging; describe only what is actually visible. A translucent, frosted or dark rounded panel behind the headline counts as a headline card. Text that ends inside the frame with its last letter whole is not clipped.
Return JSON booleans has_hex_codes, has_logo, has_garbled_text, has_text, off_brand, has_unapproved_text and a reason string.
- has_unapproved_text: the visible words differ from the approved text ${JSON.stringify(expectedText)}: a word missing, added or misspelled. Ignore case, punctuation, line breaks and whitespace. The brand's logo wordmark is allowed. Decorative lettering on objects, labels, captions or interface text is unapproved.
- has_garbled_text: letters visibly malformed, overlapping, or cut by the frame or by another object.
- has_logo: the logo is missing, appears more than once, or differs from the brand's logo in its letterforms, case, colours or mark (compare with ${hasLogoFile ? 'the logo file' : 'the logo in the references'}). A correct logo sets has_logo FALSE.
- off_brand: also when the design would not pass as one of this brand's own posts: typography visibly lighter, smaller or less assured than the references', a headline card drawn as a generic grey box instead of the brand's treatment, a hero that is decoration rather than the planned concept, or a flat composition with nothing overlapping. And for a clear departure from the references' language: a different palette, a typeface family that does not resemble theirs, a layout the brand never uses (such as the hero and the text in separate flat bands with nothing overlapping), a blank placeholder rectangle, a mock interface, or a stock-photo look that none of the references have. A composition that follows the references with a new scene and new copy is ON brand even if details differ.
- has_text: true when any text is visible (it is not a defect here). has_hex_codes: colour notation rendered in the picture.
${direction ? `THE APPROVED DIRECTION for this post: ${direction}. Every element it names must be present and read clearly (for example a lime band carrying the bold word, a glass headline card, the hero concept and where it sits in relation to the card). A named element that is missing, or a hierarchy that contradicts the direction, sets off_brand TRUE and is named in reason.` : ''}
Approve only a design the brand would publish as it is. In reason, cite only defects you can point to in the picture; otherwise return an empty string.`;
}
