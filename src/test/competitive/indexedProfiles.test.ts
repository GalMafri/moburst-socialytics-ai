import { describe, expect, it } from 'vitest';
import { extractIndexedProfiles, extractSocialHandles } from '../../../supabase/functions/_shared/competitive/extractSocialHandles';

describe('indexed profile recovery', () => {
  it('recovers a named profile without guessing its handle', () => {
    expect(extractIndexedProfiles([{title:'Fan Controlled Football (@fcfl) • Instagram photos',url:'https://www.instagram.com/fcfl/'}], 'Fan Controlled Football'))
      .toEqual([expect.objectContaining({platform:'instagram',handle:'fcfl',confidence:0.8})]);
  });
  it('rejects the unrelated accounts returned for the failing LegaBot suggestions', () => {
    expect(extractIndexedProfiles([{title:'VSI Executive Education',url:'https://instagram.com/vsieducation/'},{title:'Vergina Sports International',url:'https://instagram.com/vsi/'}], 'Virtual Sports International (VSI)')).toEqual([]);
    expect(extractIndexedProfiles([{title:'Eleven vs Eleven in a football match',url:'https://facebook.com/sofascore/posts/123'},{title:'Delsie Henry',url:'https://instagram.com/delsie.henry3/'}], 'Eleven vs Eleven')).toEqual([]);
  });
  it('does not convert search-result posts, videos or fan accounts into company profiles', () => {
    const urls=['https://x.com/someone/status/123','https://instagram.com/someone/p/abc','https://www.youtube.com/watch?v=abc','https://tiktok.com/@someone/video/123'];
    expect(extractIndexedProfiles(urls.map(url=>({url,title:'Acme Widgets'})), 'Acme Widgets')).toEqual([]);
    expect(extractIndexedProfiles([{title:'Acme Widgets unofficial',url:'https://instagram.com/acmefans/'}],'Acme Widgets')).toEqual([]);
  });
  it('rejects conflicting profile matches and requires a title', () => {
    expect(extractIndexedProfiles([{title:'Acme Widgets',url:'https://instagram.com/acme1/'},{title:'Acme Widgets',url:'https://instagram.com/acme2/'},{url:'https://x.com/acme'}],'Acme Widgets')).toEqual([]);
  });
  it('preserves legacy official YouTube URLs without inventing an @ handle', () => {
    expect(extractSocialHandles('<footer><a href="https://youtube.com/GoldenRaceOfficial">YouTube</a></footer>','GoldenRace')).toContainEqual(expect.objectContaining({platform:'youtube',handle:'GoldenRaceOfficial',profile_url:'https://www.youtube.com/GoldenRaceOfficial'}));
    expect(extractSocialHandles('https://youtube.com/feed https://youtube.com/results')).toEqual([]);
  });
});
