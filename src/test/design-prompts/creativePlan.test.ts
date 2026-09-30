import {describe,expect,it} from 'vitest';
import {parseCreativePlan,creativePlanSchema,creativeImagePrompt,creativeVideoPrompt} from '../../../supabase/functions/_shared/design-prompts/creativePlan';
const frames=Array.from({length:3},(_,i)=>({headline:`Message ${i}`,subject:`Subject ${i}`,composition:`Composition ${i}`,action:`Movement ${i}`,reference_indices:[i,(i+1)%3],layout:{reference_index:i,headline_position:["top","left","center"][i],subject_position:["bottom","right","background"][i],logo_position:"top-center"}}));
const plan={brand_system:'A measured brand system',frames,logo:{reference_index:0,x:0.1,y:0.1,width:0.2,height:0.06},caption_style:{color:'#ffffff',surface:'#101820',font_weight:400}};
describe('reference-directed creative',()=>{
  it('excludes the latest single headline position from the next structured plan',()=>{
    const schema=creativePlanSchema(1,8,false,'left');
    expect(schema.properties.frames.items.properties.layout?.properties.headline_position.enum).not.toContain('left');
    expect(schema.properties.frames.items.required).toContain('layout');
  });
  it('rejects incomplete plans, cross-library indices and duplicate scenes',()=>{
    expect(parseCreativePlan(plan,3,3,true)).toEqual(plan);
    expect(()=>parseCreativePlan({...plan,frames:frames.slice(0,2)},3,3)).toThrow();
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,reference_indices:[0,7]}))},3,3)).toThrow();
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,subject:'Same rocket'}))},3,3)).toThrow();
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,composition:'Same centered card'}))},3,3)).toThrow();
  });
  it('rejects identical visual hierarchy even when composition wording differs',()=>{
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,layout:{...f.layout,headline_position:'bottom',subject_position:'top'}}))},3,3)).toThrow('same visual hierarchy');
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,layout:{...f.layout,reference_index:7}}))},3,3)).toThrow('measured layout');
    expect(()=>parseCreativePlan({...plan,logo:undefined},3,3)).toThrow('authentic logo');
  });
  it('reserves an empty area for actual logo pixels instead of asking the image model to recreate them',()=>{
    const prompt=creativeImagePrompt(plan as never,0);
    expect(prompt).toContain('Render NO logo');
    expect(prompt).toContain('software to place the real client logo');
    expect(prompt).toContain('do not draw any header band');
    expect(prompt).toContain('PRIMARY layout reference');
  });
  it('keeps the emphasis inside the headline',()=>{
    expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,emphasis:'not in headline'}))},3,3)).toThrow('emphasised phrase');
    expect(parseCreativePlan({...plan,frames:frames.map((f,i)=>({...f,emphasis:`Message ${i}`}))},3,3).frames[1].emphasis).toBe('Message 1');
  });
  it('requires multiple distinct visual references for every frame',()=>{
    for(const reference_indices of [[0],[1,1],[-1,2]]) expect(()=>parseCreativePlan({...plan,frames:frames.map(f=>({...f,reference_indices}))},3,3)).toThrow();
  });
  it('refuses oversized logo crops and missing typography before video spend',()=>{
    expect(()=>parseCreativePlan({...plan,logo:{...plan.logo,width:0.8,height:0.8}},3,3,true)).toThrow();
    expect(()=>parseCreativePlan({...plan,caption_style:undefined},3,3,true)).toThrow();
  });
  it('gives each render only its own scene and exact headline',()=>{
    const prompt=creativeImagePrompt(plan as never,1);
    expect(prompt).toContain('Subject 1');expect(prompt).not.toContain('Message 1');
    expect(prompt).not.toContain('Subject 0');expect(prompt).not.toContain('Message 2');
    expect(prompt).toContain('take the tokens from the pixels, not from words');
    expect(prompt).toContain('Build a NEW composition');
    expect(prompt).toContain('Render NO lettering');
    expect(prompt).not.toContain('#');
  });
  it('requests three moving shots with no burned-in lettering',()=>{
    const prompt=creativeVideoPrompt(plan as never);
    for(const i of [0,1,2]) expect(prompt).toContain(`Movement ${i}`);
    expect(prompt).toContain('Cut between the three different shots at 4 and 8 seconds');
    expect(prompt).toContain('Render no lettering');expect(prompt).not.toContain('HOLD_THE_FRAME');
  });
});

describe('reference review protocol',()=>{
  it('accepts a complete structured verdict and exposes provider failures without passing them',async()=>{
    const {validateDesignImage}=await import('../../../supabase/functions/_shared/design-prompts/validateImage');
    const verdict={has_hex_codes:false,has_logo:false,has_garbled_text:false,has_text:true,off_brand:false,has_unapproved_text:false,reason:''};
    const original=globalThis.fetch,originalTimeout=AbortSignal.timeout;
    AbortSignal.timeout=()=>new AbortController().signal;
    try {
      globalThis.fetch=async(_url,init)=>{
        const body=JSON.parse(String(init?.body));
        expect(body.tool_choice.name).toBe('record_review');
        return new Response(JSON.stringify({content:[{type:'tool_use',name:'record_review',input:verdict}],stop_reason:'tool_use'}));
      };
      expect(await validateDesignImage('data:image/jpeg;base64,ZmFrZQ==',{apiKey:'fixture',creative:true})).toEqual(verdict);
      globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'Image exceeds size limit'}}),{status:400});
      const failed=await validateDesignImage('data:image/jpeg;base64,ZmFrZQ==',{apiKey:'fixture',creative:true});
      expect(failed.skipped).toBe(true);expect(failed.reason).toContain('size limit');
    } finally {globalThis.fetch=original;AbortSignal.timeout=originalTimeout;}
  });
});
