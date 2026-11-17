import { describe, it, expect } from 'vitest';
import { describeFollowFailure, FollowFailure, followFailure, refusedVisit } from '../../../supabase/functions/_shared/competitive/rivaliqFollowFailure';

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

describe('followFailure', () => {
  it('says when the plan is full, so tracking waits for a free place instead of failing', () => {
    const credits = { data: { credits: { plan: 40, distinct: 40 } } };
    const full = followFailure([{ name: 'Toast', result: { status: 3, error: credits } }]);
    expect(full).toBeInstanceOf(FollowFailure);
    expect(full.planFull).toBe(true);
    expect(full.message).toMatch(/plan tracks 40 distinct companies/);
    expect(followFailure([{ name: 'Calm', result: { status: 3, error: 'Response code 403' } }]).planFull).toBe(false);
  });

  it('names each company whose website refused the visit, by the status and RivalIQ\'s own words, and counts every other reason apart', () => {
    const REFUSED = 'ProblemFetchingUrlError: HTTPError: Response code 403 ()';
    const failure = followFailure([
      { name: 'Tailspin Cycles', result: { status: 3, error: { message: REFUSED } } },
      { name: 'Fabrikam Wheels', result: { status: 3, error: REFUSED } },
      { name: 'Proseware Gear', result: { status: 3, error: { code: 'ProblemFetchingUrlError', message: 'HTTPError: Response code 403 ()' } } },
      { name: 'Contoso Rides', result: { status: 3, error: 'Unknown company' } },
    ]);
    expect(failure.refused).toEqual(['Tailspin Cycles', 'Fabrikam Wheels', 'Proseware Gear']);
    expect(failure.others).toBe(1);
    expect(failure.planFull).toBe(false);
    expect(failure.message).toContain("the website refused RivalIQ's visit.");
    // Every website refused: nothing else is counted.
    expect(followFailure([{ name: 'Tailspin Cycles', result: { status: 3, error: { message: REFUSED } } }])).toMatchObject({ refused: ['Tailspin Cycles'], others: 0 });
  });

  it('does not take any text with 403 in it for a refusal', () => {
    const not = (result: { status?: number; error?: unknown }) => expect(refusedVisit({ result }), JSON.stringify(result)).toBe(false);
    not({ status: 3, error: 'Response code 403' });
    not({ status: 3, error: 'Forbidden' });
    not({ status: 3, error: 'Company 14030 could not be read' });
    not({ status: 3, error: { message: 'ProblemFetchingUrlError: HTTPError: Response code 4031' } });
    not({ status: 3, error: { message: 'ProblemFetchingUrlError: HTTPError: Response code 503 ()' } });
    not({ status: 3, error: { message: 'Earlier: ProblemFetchingUrlError: HTTPError: Response code 403 ()' } });
    // The words, but for a URL that was followed, is still pending, or has no status: not a refusal either.
    for (const status of [1, 2, undefined]) not({ status, error: { message: 'ProblemFetchingUrlError: HTTPError: Response code 403 ()' } });
    // The plan's allowance is a place to wait for, never a refusal.
    not({ status: 3, error: { data: { credits: { plan: 40, distinct: 40 } }, message: 'ProblemFetchingUrlError: HTTPError: Response code 403 ()' } });
    expect(refusedVisit({ result: { status: 3, error: { message: 'ProblemFetchingUrlError: HTTPError: Response code 403 ()' } } })).toBe(true);
    expect(followFailure([{ name: 'Tailspin Cycles', result: { status: 3, error: { data: { credits: { plan: 40, distinct: 40 } } } } }])).toMatchObject({ planFull: true, refused: [], others: 0 });
    expect(followFailure([{ name: 'Contoso Rides', result: { status: 3, error: 'Unknown company' } }])).toMatchObject({ refused: [], others: 1 });
    expect(new FollowFailure('x', false)).toMatchObject({ refused: [], others: 0 });
  });
});
