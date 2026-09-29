import {beforeEach, describe, expect, it, vi} from 'vitest';
import {prepareSocialTemplate, renderReviewedSocialFrame, sequenceHeadlines, type SocialTemplate} from '@/lib/socialSequence';
import {supabase} from '@/integrations/supabase/client';
import {applyReferenceTemplate} from '@/lib/referenceTemplate';
vi.mock('@/integrations/supabase/client', () => ({supabase: {functions: {invoke: vi.fn()}}}));
vi.mock('@/lib/referenceTemplate', () => ({applyReferenceTemplate: vi.fn(async () => 'composed-with-new-copy')}));
const invoke = vi.mocked(supabase.functions.invoke);
const template = {reference_preview_url:'actual-source',reference_path:'client/source.jpg',template_regions:[{x:0.2,y:0.3,width:0.5,height:0.2}],template_headline:{}} as SocialTemplate;
beforeEach(() => {vi.clearAllMocks();});
describe('source-based sequences', () => {
  it('withholds incomplete, duplicate and overlong card copy instead of saving a partial sequence', () => {
    expect(sequenceHeadlines([{headline:'First point'},{headline:'Second point'}],2)).toEqual(['First point','Second point']);
    expect(() => sequenceHeadlines([{headline:'First point'}],2)).toThrow();
    expect(() => sequenceHeadlines([{headline:'Same'},{headline:'same'}],2)).toThrow();
    expect(() => sequenceHeadlines([{headline:'word '.repeat(15)}],1)).toThrow();
  });
  it('refuses a generated picture where actual source measurements are required', async () => {
    invoke.mockResolvedValue({data:{image_url:'generated'},error:null} as never);
    await expect(prepareSocialTemplate('Post copy','client')).rejects.toThrow('reusable client social');
  });
  it('reviews the composited copy against the owned source, never the unmodified source image', async () => {
    invoke.mockResolvedValue({data:{off_brand:false},error:null} as never);
    expect(await renderReviewedSocialFrame(template,'The new message','client')).toBe('composed-with-new-copy');
    expect(applyReferenceTemplate).toHaveBeenCalledWith('actual-source','actual-source',template.template_regions,template.template_headline,'The new message');
    expect(invoke).toHaveBeenCalledWith('validate-design-output',{body:{image_data:'composed-with-new-copy',reference_path:'client/source.jpg',expected_text:'The new message',client_id:'client'}});
  });
  it('withholds frames when comparison fails, is skipped, or is unavailable', async () => {
    for (const result of [{data:{off_brand:true,reason:'Changed artwork'},error:null},{data:{skipped:true},error:null},{data:null,error:new Error('network')},{data:{error:'model unavailable'},error:null}]) {
      invoke.mockResolvedValue(result as never);
      await expect(renderReviewedSocialFrame(template,'New copy','client')).rejects.toThrow();
    }
  });
});
