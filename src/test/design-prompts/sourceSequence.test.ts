import {describe,it,expect} from 'vitest';
import {sourceSequenceIssue} from '../../../supabase/functions/_shared/design-prompts/sourceSequence';
const cards=(...texts:string[])=>texts.map(headline=>({headline}));
describe('complete source-card copy',()=>{
 it('accepts supported standalone insights and a takeaway',()=>{expect(sourceSequenceIssue(cards('Yesterday’s dashboards can miss AI discovery.','Review how you measure brand visibility.','Bring AI discovery into your reporting review.'),3)).toBeNull();});
 it('rejects the observed promise of three checks without content',()=>{expect(sourceSequenceIssue(cards('Your AI visibility metrics are outdated.','Three practical checks identify discoverability risk.','Start using these checks now.'),3)).not.toBeNull();});
 it('rejects teaser openings and hashtags on artwork',()=>{for(const text of ["Here’s what to measure instead.",'Three checks for your next review.','Save this. #Moburst'])expect(sourceSequenceIssue(cards(text,'Review your visibility.'),2)).not.toBeNull();});
 it('requires the complete distinct bounded sequence',()=>{expect(sourceSequenceIssue(cards('Only one'),3)).not.toBeNull();expect(sourceSequenceIssue(cards('Same','same'),2)).not.toBeNull();expect(sourceSequenceIssue(cards('word '.repeat(15),'Short'),2)).not.toBeNull();});
});
