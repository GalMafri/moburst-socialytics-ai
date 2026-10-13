import { it, expect } from 'vitest';
import { reportNotices } from '@/lib/reportNotices';

const brief = 'The linked brief could not be read. Use a Google Doc, text file or text-based PDF, or paste the brief into client setup. This analysis has no text from that brief.';
it('keeps setup notes until their cause is fixed in client setup', () => {
  expect(reportNotices([brief, 'Trends were not collected.'], { briefText: '' })).toEqual([brief, 'Trends were not collected.']);
  expect(reportNotices([brief, 'Trends were not collected.'], { briefText: 'Bader Law. Organic Social Media Strategy' })).toEqual(['Trends were not collected.']);
  expect(reportNotices(null, {})).toEqual([]);
  expect(reportNotices([3, ''], {})).toEqual([]);
});
