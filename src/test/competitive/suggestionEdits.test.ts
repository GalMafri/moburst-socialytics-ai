import { describe, it, expect } from 'vitest';
import { editedSuggestion, learningLines, parseLearnings, parseRevision } from '../../../supabase/functions/_shared/competitive/suggestionEdits';
import { competitiveContext, insightKey } from '../../../supabase/functions/_shared/reports/payloads';

describe('suggested test edits', () => {
  const g = { gap: 'Post more video on Instagram', why_it_matters: 'Rivals post 3x more video.', suggested_play: 'Two Reels a week.', platform: 'instagram' };
  it('replaces only the edited, non-empty fields', () => {
    expect(editedSuggestion(g, null)).toEqual({ ...g, edited: false });
    expect(editedSuggestion(g, { gap: '  Lead with LinkedIn  ', why_it_matters: '', suggested_play: null })).toEqual({ ...g, gap: 'Lead with LinkedIn', edited: true });
  });
  it('accepts a usable rewrite and refuses an empty or oversized one', () => {
    expect(parseRevision('ok {"gap":"A","why_it_matters":"B","suggested_play":"C"}')).toEqual({ gap: 'A', why_it_matters: 'B', suggested_play: 'C' });
    expect(parseRevision('{"gap":"","suggested_play":"C"}')).toBeNull();
    expect(parseRevision(`{"gap":"${'x'.repeat(200)}","suggested_play":"C"}`)).toBeNull();
    expect(parseRevision('no json')).toBeNull();
  });
  it('keeps at most two learned preferences, each one sentence', () => {
    const out = parseLearnings('{"rules":[{"kind":"avoid","text":"Paid tactics"},{"kind":"x","text":"Lead with LinkedIn"},{"kind":"prefer","text":"Third"}]}');
    expect(out).toEqual([{ kind: 'avoid', text: 'Paid tactics' }, { kind: 'prefer', text: 'Lead with LinkedIn' }]);
    expect(learningLines(out)).toEqual(['Avoid: Paid tactics', 'Prefer: Lead with LinkedIn']);
  });
  it('gives the monthly report the edited wording and the learned preferences', () => {
    const report = { created_at: '2026-10-07', report_data: { period: { start: '2026-09-01', end: '2026-09-30' }, aggregates: { companies: [{ name: 'Brand', is_client: true, post_count: 4 }, { name: 'Rival', is_client: false, post_count: 3 }] }, ai_analysis: { gaps_for_client: [g] } } };
    const ctx: any = competitiveContext(report, [{ insight_key: insightKey(g.gap), verdict: 'up', gap_text: g.gap, edited: { gap: 'Lead with LinkedIn' } }], [{ kind: 'prefer', text: 'Targets are cadences' }]);
    expect(ctx.gaps[0]).toMatchObject({ gap: 'Lead with LinkedIn', endorsed: true, suggested_play: 'Two Reels a week.' });
    expect(ctx.endorsed_gaps).toEqual(['Lead with LinkedIn']);
    expect(ctx.team_preferences).toEqual(['Prefer: Targets are cadences']);
  });
});
