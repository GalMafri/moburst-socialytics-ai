import { expect, it } from 'vitest';
import { competitiveRangeError } from '../../../supabase/functions/_shared/reports/competitiveRange';
const now=new Date('2026-09-24T01:00:00Z');
it.each([['2026-02-30','2026-03-02'],['2026-09-24','2026-09-24'],['2026-09-23','2026-09-22'],['2024-01-01','2026-01-01'],['','2026-08-31']])('rejects incomplete or invalid periods %s %s',(start,end)=>expect(competitiveRangeError({start,end},now)).toBeTruthy());
it.each([['2026-09-23','2026-09-23'],['2024-02-29','2024-02-29'],['2026-08-01','2026-08-31']])('accepts complete UTC dates %s %s',(start,end)=>expect(competitiveRangeError({start,end},now)).toBeNull());
