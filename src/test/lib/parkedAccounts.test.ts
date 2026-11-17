import { describe, expect, it } from 'vitest';
import { PARKED_FALLBACK, parkedAccounts, parkedLine } from '@/lib/parkedAccounts';

// Accounts set aside for a client, as the setup page reads and says them (invented brand).

describe('parkedAccounts', () => {
  const row = (over: Record<string, unknown>) => ({ sprout_profile_id: 1, profile_name: 'Harbor Wax (Lakeside)', native_name: null, network_type: 'facebook', native_link: null, is_active: false, parked_at: '2026-11-18T09:00:00Z', parked_reason: 'x', ...over });

  it('keeps the rows that are switched off with the record of it', () => {
    expect(parkedAccounts([row({ sprout_profile_id: 1 }), row({ sprout_profile_id: 2, parked_at: null }), row({ sprout_profile_id: 3, is_active: true }), row({ sprout_profile_id: 4, is_active: null })]).map((r) => r.sprout_profile_id)).toEqual([1]);
  });

  it('reads anything that is not a list of rows as none', () => {
    for (const rows of [null, undefined, 'x', {}, [null, 'x', 3]]) expect(parkedAccounts(rows)).toEqual([]);
  });
});

describe('parkedLine', () => {
  it("says the row's own reason, then what a person can do", () => {
    expect(parkedLine('The brand\'s own Facebook account is "Harbor Wax".')).toBe('Not used: the brand\'s own Facebook account is "Harbor Wax". Add it back to use this one instead.');
    // A reason without its full stop still reads as one sentence.
    expect(parkedLine('The brand\'s own Instagram account is "Harbor Wax"')).toBe('Not used: the brand\'s own Instagram account is "Harbor Wax". Add it back to use this one instead.');
  });

  it('says a plain sentence when the row carries no reason', () => {
    expect(PARKED_FALLBACK).toBe("The brand's own account on this network is another one.");
    for (const none of [null, undefined, '', '   ']) expect(parkedLine(none)).toBe("Not used: the brand's own account on this network is another one. Add it back to use this one instead.");
  });
});
