import { describe, it, expect } from 'vitest';
import { parseReferenceDirection, referenceRenderPrompt } from '../../../supabase/functions/_shared/design-prompts/referenceDirection';

const brief = 'Match the top-centered source logo, fine multicolor frame, generous upper margin and compact white headline on the source dark card.';
describe('specific reference art direction', () => {
  it('binds selection to the supplied client references', () => {
    expect(parseReferenceDirection(JSON.stringify({reference_index:1,brief}), ['client/a.jpg','client/b.jpg']).path).toBe('client/b.jpg');
  });
  it('rejects invalid or fabricated source choices', () => {
    for (const index of [-1,2,0.5,'0']) expect(() => parseReferenceDirection(JSON.stringify({reference_index:index,brief}), ['client/a.jpg','client/b.jpg'])).toThrow();
    expect(() => parseReferenceDirection(JSON.stringify({reference_index:0,brief:'blue'}), ['client/a.jpg'])).toThrow();
  });
  it('preserves branding and approved copy while excluding stale report art', () => {
    const prompt = referenceRenderPrompt({path:'client/a.jpg',brief}, 'Plan before launch. Longer caption here.', 'Old holographic map\n\nCRITICAL CORRECTIONS, the previous attempt failed review:\n- Restore the source border.');
    expect(prompt).toContain('authentic brand logo');
    expect(prompt).toContain('"Plan before launch"');
    expect(prompt).toContain('Restore the source border');
    expect(prompt).not.toContain('Old holographic map');
    expect(prompt).not.toContain('Longer caption here');
  });
});
