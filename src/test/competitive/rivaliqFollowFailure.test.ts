import { describe, it, expect } from 'vitest';
import { describeFollowFailure } from '../../../supabase/functions/_shared/competitive/rivaliqFollowFailure';

describe('describeFollowFailure', () => {
  it('turns the credits snapshot into the plan sentence, names blocked websites, and keeps other errors short', () => {
    const credits = { data: { credits: { plan: 40, used: 0, swaps: 40, total: 40, swapped: 0, distinct: 40, remaining: 40 } } };
    expect(describeFollowFailure([{ name: 'Quince', result: { status: 3, error: credits } }, { name: 'Brooklinen', result: { status: 3, error: credits } }]))
      .toBe("RivalIQ's plan tracks 40 distinct companies and 40 are in use, so Quince and Brooklinen could not be added. Unfollow a company from an old landscape in RivalIQ, or raise the plan.");
    expect(describeFollowFailure([{ name: 'Calm', result: { status: 3, error: { message: 'ProblemFetchingUrlError: HTTPError: Response code 403 ()' } } }, { name: 'Headspace', result: { status: 3, error: credits } }]))
      .toBe("RivalIQ's plan tracks 40 distinct companies and 40 are in use, so Headspace could not be added. Unfollow a company from an old landscape in RivalIQ, or raise the plan. Calm: the website refused RivalIQ's visit.");
    expect(describeFollowFailure([{ name: 'Acme', result: { status: 3, error: 'Unknown company' } }])).toBe('RivalIQ could not finish tracking every reviewed website. Acme: Unknown company');
    expect(describeFollowFailure([{ name: 'Reviewed company', result: { status: 3 } }])).toBe('RivalIQ could not finish tracking every reviewed website. Reviewed company: no reason given');
    expect(describeFollowFailure([{ name: 'One', result: { status: 3, error: { code: 'CompanyNotFound', message: 'No public profiles found' } } }])).toBe('RivalIQ could not finish tracking every reviewed website. One: CompanyNotFound: No public profiles found');
    expect(describeFollowFailure([])).toBe('RivalIQ could not start tracking the reviewed websites.');
  });
});
