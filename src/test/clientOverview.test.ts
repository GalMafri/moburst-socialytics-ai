import { describe, it, expect } from 'vitest';
import { actionItems, competitiveStanding, contentWeek, reportHeadline } from '@/lib/clientOverview';

describe('client overview', () => {
  it('takes three headline metrics from the report and counts what rose', () => {
    const rd = [{ sprout_performance: { month_comparison: { changes: {
      impressions: { current: 1200, previous: 1000, percent: 20 },
      reactions: { current: 50, previous: 60, percent: -16.7 },
      video_views: { current: 300, previous: 300, percent: 0 },
      shares: { current: 9, previous: 3, percent: 200 },
    } } } }];
    const h = reportHeadline(rd)!;
    expect(h.metrics.map((m) => m.key)).toEqual(['impressions', 'reactions', 'video_views']);
    expect(h.rose).toBe(2);
    expect(h.total).toBe(4);
    expect(reportHeadline({})).toBeNull();
  });
  it('says where the client leads and trails', () => {
    const s = competitiveStanding({ share_of_voice_pct: 19, competitors: [{ name: 'A' }, { name: 'B' }], benchmark_dimensions: [{ dimension: 'Audience', client: 10, competitor_avg: 5 }, { dimension: 'Cadence', client: 2, competitor_avg: 4 }] })!;
    expect(s).toEqual({ shareOfVoice: 19, competitors: ['A', 'B'], ahead: ['audience'], behind: ['cadence'] });
  });
  it('counts the coming week and finds posts without a design or approval, ignoring unwritten trend slots', () => {
    const posts = [
      { id: '1', post_key: 'k1', post_date: '2026-10-13', platform: 'LinkedIn', source: 'report', copy: 'a' },
      { id: '2', post_key: 'k2', post_date: '2026-10-15', platform: 'LinkedIn', source: 'report', copy: 'b' },
      { id: '3', post_key: 'k3', post_date: '2026-10-18', platform: 'X', source: 'plan', copy: '' },
      { id: '4', post_key: 'k4', post_date: '2026-10-25', platform: 'X', source: 'report', copy: 'd' },
    ];
    const media = [{ calendar_post_key: 'k1', is_selected: true, is_approved: true, media_urls: ['x.png'] }];
    const w = contentWeek(posts, media, '2026-10-13');
    expect([w.planned, w.designed, w.approved]).toEqual([2, 1, 1]);
    expect(w.withoutDesign.map((p) => p.id)).toEqual(['2']);
    expect(w.unapprovedSoon.map((p) => p.id)).toEqual(['2']);
    const items = actionItems({ clientId: 'c', isStaff: false, today: '2026-10-13', content: w, lastRun: { status: 'failed', created_at: '' }, hasReport: true, tracking: { headline: 'Tracking needs reconnecting', ready: false }, hasCompetitiveReport: false, openTopics: 4, endorsedTests: 0 });
    // A client sees only their content items, never setup or run problems.
    expect(items.map((i) => i.key)).toEqual(['approve', 'design']);
    expect(items[0].href).toBe('/clients/c/calendar?week=2026-10-12');
    const staff = actionItems({ clientId: 'c', isStaff: true, today: '2026-10-13', content: w, lastRun: { status: 'failed', created_at: '' }, hasReport: true, tracking: { headline: 'Tracking needs reconnecting', ready: false }, hasCompetitiveReport: true, openTopics: 4, endorsedTests: 2 });
    expect(staff.map((i) => i.key)).toEqual(['approve', 'design', 'report-failed', 'tracking', 'topics', 'tests']);
  });
});
