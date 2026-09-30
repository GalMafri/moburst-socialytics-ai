import {describe,it,expect,vi,beforeEach} from 'vitest';
import {supabase} from '@/integrations/supabase/client';
import {produceCreative,planCreative,frameIndexFor,type ProductionPlan} from '@/lib/creativeProduction';
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:vi.fn()},storage:{from:()=>({getPublicUrl:(p:string)=>({data:{publicUrl:'https://storage/'+p}}),upload:vi.fn(async()=>({error:null}))})},from:()=>({update:()=>({eq:()=>Promise.resolve({error:null})})})}}));
vi.mock('@/lib/composeText',()=>({loadImage:vi.fn(async()=>({naturalWidth:2048,naturalHeight:2048}))}));
vi.mock('@/lib/brandLogo',()=>({finishBrandStatic:vi.fn(async(url:string)=>'data:image/png;base64,'+url)}));
const invoke=vi.mocked(supabase.functions.invoke);
const plan={id:'plan',frames:[{headline:'New idea',subject:'A lens',reference_indices:[0,1]}],reference_previews:['r1','r2']} as ProductionPlan;
beforeEach(()=>{vi.useRealTimers();vi.clearAllMocks();globalThis.fetch=vi.fn(async()=>({blob:async()=>new Blob(['x'])})) as never;});
describe('server-owned creative production',()=>{
  it('follows the run until the server completes it, then finishes and saves the design',async()=>{
    vi.useFakeTimers();
    invoke.mockResolvedValueOnce({data:{count:1,frames:[{index:0,state:'rendering',attempt:0,url:null,preview:null,error:null}],done:false,failed:false,iterations:[]},error:null} as never)
      .mockResolvedValueOnce({data:{count:1,frames:[{index:0,state:'approved',attempt:0,url:'https://storage/art.png',preview:'https://storage/art.png',error:null}],done:true,failed:false,iterations:[{id:'it1',media_urls:['https://storage/art.png'],frames:[0],finishing:'pending'}]},error:null} as never);
    const progress=vi.fn();
    const pending=produceCreative(plan,'client',{copy:'new message',platform:'LinkedIn',format:'Single Image'},{onProgress:progress});
    await vi.advanceTimersByTimeAsync(8000);
    const urls=await pending;
    expect(urls).toHaveLength(1);expect(urls[0]).toContain('https://storage/client/');
    expect(invoke.mock.calls.map(c=>c[0])).toEqual(['advance-creative-plan','advance-creative-plan']);
    expect(invoke.mock.calls[0][1]?.body).toMatchObject({plan_id:'plan',client_id:'client'});
    expect(progress).toHaveBeenLastCalledWith(1,1,expect.any(Array));
    vi.useRealTimers();
  });
  it('surfaces a failed frame with its artwork preview',async()=>{
    invoke.mockResolvedValueOnce({data:{count:1,frames:[{index:0,state:'failed',attempt:1,url:null,preview:'https://storage/bad.png',error:'Brand review rejected the artwork: lettering'}],done:false,failed:true,iterations:[]},error:null} as never);
    await expect(produceCreative(plan,'client',{copy:'x'})).rejects.toThrow('lettering');
  });
  it('maps a saved single design back to its plan frame by subject',()=>{
    expect(frameIndexFor(plan,{variant_angle:'Reference creative plan: A lens'},3)).toBe(0);
    expect(frameIndexFor(plan,{variant_angle:'Reference creative 00000000-0000-0000-0000-000000000000'},2)).toBe(2);
  });
  it('does not accept a partial storyboard',async()=>{
    invoke.mockResolvedValue({data:plan,error:null} as never);
    await expect(planCreative('client',{copy:'copy'},'video',3)).rejects.toThrow('incomplete');
  });
});
