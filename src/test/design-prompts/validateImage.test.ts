import { describe, expect, it } from 'vitest';
import { parseDesignVerdict } from '../../../supabase/functions/_shared/design-prompts/validateImage';

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
