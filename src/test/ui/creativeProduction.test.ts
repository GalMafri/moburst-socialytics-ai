import {describe,it,expect,vi,beforeEach} from 'vitest';
import {supabase} from '@/integrations/supabase/client';
import {renderCreative,planCreative,type ProductionPlan} from '@/lib/creativeProduction';
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()}}}));
const invoke=vi.mocked(supabase.functions.invoke);
const plan={id:'plan',frames:[{headline:'New idea',reference_indices:[0,1]}],reference_previews:['r1','r2']} as ProductionPlan;
beforeEach(()=>vi.clearAllMocks());
describe('creative production',()=>{
  it('rejects old source-artwork responses instead of painting the same template',async()=>{
    invoke.mockResolvedValue({data:{rendered_by:'source_artwork',image_url:'old-card'},error:null} as never);
    await expect(renderCreative(plan,0,'client',{copy:'new message'})).rejects.toThrow('new reference-backed design');
  });
  it('uses the persisted plan for image generation and reference review',async()=>{
    invoke.mockResolvedValueOnce({data:{rendered_by:'reference_creative',image_url:'new-art'},error:null} as never).mockResolvedValueOnce({data:{off_brand:false},error:null} as never);
    expect(await renderCreative(plan,0,'client',{copy:'new message'})).toBe('new-art');
    expect(invoke.mock.calls[1][1]?.body).toMatchObject({creative_plan_id:'plan',creative_frame_index:0,client_id:'client',image_data:'new-art'});
  });
  it('withholds images when visual reference review is unavailable',async()=>{
    invoke.mockResolvedValueOnce({data:{rendered_by:'reference_creative',image_url:'new-art'},error:null} as never).mockResolvedValueOnce({data:{skipped:true},error:null} as never);
    await expect(renderCreative(plan,0,'client',{copy:'new message'})).rejects.toThrow('withheld');
    expect(invoke).toHaveBeenCalledTimes(2);
  });
  it('does not accept a partial storyboard',async()=>{
    invoke.mockResolvedValue({data:plan,error:null} as never);
    await expect(planCreative('client',{copy:'copy'},'video',3)).rejects.toThrow('incomplete');
  });
});
