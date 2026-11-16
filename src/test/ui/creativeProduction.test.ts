import {describe,it,expect,vi,beforeEach} from 'vitest';
import {supabase} from '@/integrations/supabase/client';
import {finishIterations,frameIndexFor,type ProductionPlan} from '@/lib/creativeProduction';
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()},storage:{from:()=>({getPublicUrl:(p:string)=>({data:{publicUrl:'https://storage/'+p}}),upload:vi.fn(async()=>({error:null}))})},from:()=>({update:()=>({eq:()=>Promise.resolve({error:null})})})}}));
vi.mock('@/lib/brandLogo',()=>({finishBrandStatic:vi.fn(async(url:string)=>'data:image/png;base64,'+url)}));
const plan={id:'plan',frames:[{headline:'New idea',subject:'A lens',reference_indices:[0,1]}],reference_previews:['r1','r2']} as ProductionPlan;
beforeEach(()=>{vi.clearAllMocks();globalThis.fetch=vi.fn(async()=>({blob:async()=>new Blob(['x'])})) as never;});
describe('creative production finishing',()=>{
  it('finishes server-completed artwork and saves the design',async()=>{
    const urls=await finishIterations([{id:'it1',media_urls:['https://storage/art.png'],frames:[0],finishing:'pending'}],{...plan,client_id:'client'},{platform:'LinkedIn',format:'Single Image'});
    expect(urls).toHaveLength(1);expect(urls[0]).toContain('https://storage/client/');
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
  it('keeps artwork that is already finished as it is',async()=>{
    const urls=await finishIterations([{id:'it2',media_urls:['https://storage/done.png'],frames:[0],finishing:'done'}],plan,{});
    expect(urls).toEqual(['https://storage/done.png']);
  });
  it('maps a saved single design back to its plan frame by subject',()=>{
    expect(frameIndexFor(plan,{variant_angle:'Reference creative plan: A lens'},3)).toBe(0);
    expect(frameIndexFor(plan,{variant_angle:'Reference creative 00000000-0000-0000-0000-000000000000'},2)).toBe(2);
  });
});
