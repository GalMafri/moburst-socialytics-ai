import { it, expect } from 'vitest';
import { reportNotices } from '@/lib/reportNotices';

const unread = 'The linked brief could not be read. Use a Google Doc, text file or text-based PDF, or paste the brief into client setup. This analysis has no text from that brief.';
const unsummarized = 'The brief could not be summarized; its original text was included in the analysis.';
it('never shows a note about the brief, with or without brief text in setup', () => {
  expect(reportNotices([unread, 'Trends were not collected.'], { briefText: '' })).toEqual(['Trends were not collected.']);
  expect(reportNotices([unread, unsummarized, 'Trends were not collected.'], { briefText: 'Bader Law. Organic Social Media Strategy' })).toEqual(['Trends were not collected.']);
  expect(reportNotices(null, {})).toEqual([]);
  expect(reportNotices([3, ''], {})).toEqual([]);
});
