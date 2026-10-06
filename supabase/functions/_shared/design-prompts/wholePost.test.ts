import { expect, it } from 'vitest';
const assert = (v: unknown, msg?: string) => expect(v, msg).toBeTruthy();
const assertEquals = (a: unknown, b: unknown) => expect(a).toEqual(b);
const assertStringIncludes = (s: string, part: string) => expect(s).toContain(part);
import { counterText, wholePostCorrection, wholePostExpectedText, wholePostPrompt, wholePostQuestion } from './wholePost.ts';

const plan: any = {
  brand_system: 'Dark navy depth, cyan light, glass headline cards, rainbow frame on carousels.',
  frames: [
    { headline: 'AEO is not SEO with new initials.', emphasis: 'new initials', subject: 'a chrome compass whose needle is a beam of light', composition: 'card centred, compass low', action: '', reference_indices: [1, 2], layout: { reference_index: 1, headline_position: 'center', subject_position: 'bottom', logo_position: 'top-center' } },
    { headline: 'Retention is won before day one.', emphasis: '', subject: 'an hourglass of light', composition: '', action: '', reference_indices: [1, 2] },
  ],
};

it('the approved headline is the only text, with a counter on carousel slides', () => {
  assertEquals(wholePostExpectedText(plan, 0, 'single'), 'AEO is not SEO with new initials.');
  assertEquals(wholePostExpectedText(plan, 1, 'carousel'), 'Retention is won before day one. 02 / 02');
  assertEquals(counterText('single', 0, 1), '');
});

it('the prompt asks for one finished picture with the exact words, the brand language and the logo', () => {
  const p = wholePostPrompt(plan, 0, undefined, 'single', true);
  assertStringIncludes(p, '"AEO is not SEO with new initials."');
  assertStringIncludes(p, '"new initials"');
  assertStringIncludes(p, 'ONLY logo for this post');
  assertStringIncludes(p, 'never use those');
  assertStringIncludes(p, 'ONE finished picture');
  assertStringIncludes(p, 'headline center, hero bottom, logo top-center');
  assertStringIncludes(p, 'Arrangement for this post: card centred, compass low');
  assertStringIncludes(p, 'FIRST attached post is the layout reference');
  assertStringIncludes(p, 'no slide counter');
  assert(!p.includes('Render NO lettering'), 'the whole-post prompt never forbids lettering');
  const noFile = wholePostPrompt(plan, 1, undefined, 'carousel', false, 'the hourglass hid the words');
  assertStringIncludes(noFile, 'exactly as it appears in the attached posts');
  assertStringIncludes(noFile, '"02 / 02"');
  assertStringIncludes(noFile, 'Correct the previous attempt: the hourglass hid the words');
});

it('a failed review becomes a concrete correction', () => {
  const c = wholePostCorrection({ has_unapproved_text: true, has_logo: true, off_brand: false, has_garbled_text: false, has_hex_codes: false, has_text: true, reason: '' } as any, 'Retention is won before day one.');
  assertStringIncludes(c, 'Render exactly this text and nothing else: "Retention is won before day one."');
  assertStringIncludes(c, 'Place the brand\'s logo once');
  assertEquals(wholePostCorrection({ has_unapproved_text: false, has_logo: false, off_brand: false, has_garbled_text: false, has_hex_codes: false, has_text: true, reason: 'a faint caption on the device' } as any, 'x'), 'a faint caption on the device');
});

it('the reviewer is told what counts as a defect and what does not', () => {
  const q = wholePostQuestion('App Store Myths. Busted.', true, 'gems around the card');
  assertStringIncludes(q, '"App Store Myths. Busted."');
  assertStringIncludes(q, 'counts as a headline card');
  assertStringIncludes(q, 'one word rendered in more than one colour');
  assertStringIncludes(q, 'A correct logo sets has_logo FALSE');
  assertStringIncludes(q, "THE BRAND'S LOGO FILE");
  assertStringIncludes(q, 'sub-brand wordmark');
  assertStringIncludes(q, 'gems around the card');
});
