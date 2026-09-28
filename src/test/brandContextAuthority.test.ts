import { expect, it } from 'vitest';
import { resolveBrandContext } from '../../supabase/functions/_shared/design-prompts/resolveBrand';
it('uses the current client corpus even when an old report supplied a complete stale style', async () => {
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: {
    brand_identity: { font_family: 'Current' }, design_style_synthesis: { imagery_style: 'Current evidence' },
    design_references: ['manual.png'], harvested_design_references: [{ path: 'social.png', quality_checked: true }],
  } }) }) }) }) };
  const result = await resolveBrandContext({ supabase: db, clientId: 'client', clientContext: {
    brand_identity: { font_family: 'Stale' }, design_style_synthesis: { imagery_style: 'Gems and rockets' }, design_references: ['stale.png'],
  } });
  expect(result.source).toBe('database');
  expect(result.synthesis?.imagery_style).toBe('Current evidence');
  expect(result.designReferences).toEqual(['social.png']);
});
