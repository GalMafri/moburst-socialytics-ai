import { it, expect } from 'vitest';
import { clipText } from '@/lib/clipText';

it('never splits a character when shortening text', () => {
  const s = 'ab🏆cd';
  expect('ab🏆cd'.slice(0, 3)).not.toBe('ab🏆'); // the bug: half an emoji
  expect(clipText(s, 3)).toBe('ab🏆');
  expect(JSON.stringify(clipText(s, 3))).not.toMatch(/\\ud83c"$/);
  expect(clipText(null, 5)).toBe('');
  expect(clipText('short', 10)).toBe('short');
});
