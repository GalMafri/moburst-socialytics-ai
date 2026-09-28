import { describe, expect, it } from 'vitest';
import { sproutCandidates, usableClassification, referenceFingerprint } from '../../supabase/functions/_shared/brand-references/candidates';
import { referencesFor } from '../../supabase/functions/_shared/design-prompts/designRefs';

const post = { guid: 'ig:1', customer_profile_id: 7, sent: true, perma_link: 'https://instagram.com/p/example',
  created_time: '2026-09-20', network: 'INSTAGRAM', content_category: 'PHOTO',
  visual_media: [{ media_type: 'PHOTO', media_url: 'https://s.cdninstagram.com/image.jpg' }] };

describe('automatic brand evidence', () => {
  it('rejects foreign accounts, received messages and unknown ownership', () => {
    expect(sproutCandidates([{ ...post, customer_profile_id: 8 }, { ...post, sent: false }, { ...post, sent: undefined }], ['7'])).toEqual([]);
  });
  it('does not learn static layouts from video thumbnails or link previews', () => {
    expect(sproutCandidates([{ ...post, content_category: 'VIDEO' }, { ...post, content_category: 'LINK' }], ['7'])).toEqual([]);
  });
  it('retains source provenance and deduplicates cross-posted images', () => {
    const result = sproutCandidates([post, { ...post, guid: 'fb:2' }], ['7']);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ source_post_id: 'ig:1', source_url: post.perma_link, profile_id: '7' });
  });
  it('keeps only one still per carousel', () => {
    expect(sproutCandidates([{ ...post, content_category: 'ALBUM', visual_media: [...post.visual_media, { media_type: 'PHOTO', media_url: 'https://s.cdninstagram.com/second.jpg' }] }], ['7'])).toHaveLength(1);
  });
  it('fails closed on missing, negative or low confidence classification', () => {
    for (const v of [null, {}, { usable: true }, { usable: true, confidence: .5, reason: 'photo' }, { usable: false, confidence: .99, reason: 'photo' }]) expect(usableClassification(v)).toBe(false);
    expect(usableClassification({ usable: true, confidence: .95, reason: 'Consistent brand typography and color blocks' })).toBe(true);
  });
  it('invalidates the cache after account or customer reassignment, not ordering changes', () => {
    expect(referenceFingerprint(['8','7'], '1')).toBe(referenceFingerprint(['7','8'], '1'));
    expect(referenceFingerprint(['7'], '1')).not.toBe(referenceFingerprint(['8'], '1'));
    expect(referenceFingerprint(['7'], '1')).not.toBe(referenceFingerprint(['7'], '2'));
  });
  it('gives reviewed social posts priority over stale manual references', () => {
    expect(referencesFor(['old.png'], [{ path: 'social.png', quality_checked: true }, { path: 'unvetted.png' }], 1)).toEqual(['social.png']);
  });
});
