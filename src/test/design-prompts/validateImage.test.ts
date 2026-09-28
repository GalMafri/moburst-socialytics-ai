import { describe, expect, it } from 'vitest';
import { parseDesignVerdict, questionFor } from '../../../supabase/functions/_shared/design-prompts/validateImage';

describe('structured creative review', () => {
  const clean = { has_hex_codes: false, has_logo: false, has_garbled_text: false, has_text: true, off_brand: false, reason: '' };
  it('retains observed text without declaring it a defect', () => {
    expect(parseDesignVerdict(JSON.stringify(clean))).toEqual(clean);
  });
  it('retains the precise visible defect for correction', () => {
    const bad = { ...clean, off_brand: true, reason: 'White background violates the dark background rule.' };
    expect(parseDesignVerdict(JSON.stringify(bad))).toEqual(bad);
  });
  it('rejects missing or ambiguous checks instead of passing them', () => {
    for (const value of ['YES NO NO', '{}', JSON.stringify({ ...clean, off_brand: 'false' })]) {
      expect(parseDesignVerdict(value).skipped).toBe(true);
    }
  });
});

it('defines demonstrated false-positive boundaries without skipping review', () => {
 const prompt = questionFor('Never render an all-caps headline.');
 expect(prompt).toContain('is NOT all-caps');
 expect(prompt).toContain('is NEVER a blank placeholder');
 expect(prompt).toContain('actual controls');
 expect(prompt).toContain('Never render an all-caps headline.');
});
