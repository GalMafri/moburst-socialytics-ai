import { describe,it,expect,vi } from 'vitest';
import { parseReferenceTemplate,templateFromResponse, selectReferenceTemplate } from '../../../supabase/functions/_shared/design-prompts/referenceTemplate';
import { applyReferenceTemplate, wrapTemplateWords } from '../../lib/referenceTemplate';
vi.mock('../../lib/sourceLettering',()=>({clearSourceLettering:vi.fn((_pixels,_regions,headline)=>headline)}));
vi.mock('../../../supabase/functions/_shared/design-prompts/sourceImage',()=>({sourceImage:vi.fn(async()=>({type:'image',source:{type:'base64',data:'source'}}))}));
vi.mock('../../lib/composeText',()=>({loadImage:vi.fn(async (url:string)=>({naturalWidth:url==='source'?1000:2000,naturalHeight:url==='source'?1250:2500}))}));
const headline={x:0.22,y:0.32,width:0.56,height:0.16,font_family:'Arial',font_weight:400,font_size:0.05,line_height:1.12,align:'center' as const,color:'#ffffff',emphasis_words:2};
const value={reference_index:0,aspect:'4:5',regions:[{x:0.2,y:0.3,width:0.6,height:0.2}],headline};
describe('actual social artwork templates',()=>{
 it('binds template to owned source and rejects broad redraws or invalid coordinates',()=>{
  expect(parseReferenceTemplate(JSON.stringify(value),['owned']).path).toBe('owned');
  for(const v of [{...value,reference_index:-1},{...value,regions:[{x:0,y:0,width:1,height:1}]},{...value,regions:[{x:-0.2,y:0,width:0.5,height:0.2}]},{...value,regions:[]}]) expect(()=>parseReferenceTemplate(JSON.stringify(v),['owned'])).toThrow();
 });
 it('draws only the original source and typesets the approved copy without loading a generated image',async()=>{
  const drawImage=vi.fn(); const canvas={width:0,height:0,getContext:()=>({drawImage,getImageData:()=>({}),putImageData:vi.fn(),measureText:(text:string)=>({width:text.length*20}),save:vi.fn(),restore:vi.fn(),beginPath:vi.fn(),rect:vi.fn(),clip:vi.fn(),fillText:vi.fn()}),toDataURL:()=> 'data:image/png;base64,result'};
  const spy=vi.spyOn(document,'createElement').mockReturnValue(canvas as any);
  try {
   expect(await applyReferenceTemplate('source','edit',value.regions,headline,'Plan growth before launch')).toContain('result');
   expect(canvas.width).toBe(1000);expect(canvas.height).toBe(1250);
   expect(drawImage).toHaveBeenCalledTimes(1);
   expect(drawImage.mock.calls[0].slice(1)).toEqual([0,0]);
  } finally {spy.mockRestore();}
 });
 it('refuses a whole-canvas replacement before loading it',async()=>{
  await expect(applyReferenceTemplate('source','edit',[{x:0,y:0,width:1,height:1}])).rejects.toThrow();
 });
});

it('wraps actual typeset words without splitting or dropping any approved copy',()=>{const words='A strong media plan starts before launch'.split(' ').map(text=>({text,bold:false}));const lines=wrapTemplateWords(words,65,t=>t.length*5);expect(lines.flat().map(w=>w.text)).toEqual(words.map(w=>w.text));expect(lines.length).toBeGreaterThan(1);});

it('requires structured source measurements and ignores conversational text',()=>{expect(templateFromResponse({content:[{type:'text',text:'Looking at the source'},{type:'tool_use',name:'record_source_template',input:value}],stop_reason:'tool_use'},['owned']).path).toBe('owned');expect(()=>templateFromResponse({content:[{type:'text',text:'I will analyze'}]},['owned'])).toThrow('incomplete');expect(()=>templateFromResponse({content:[{type:'tool_use',name:'record_source_template',input:value}],stop_reason:'max_tokens'},['owned'])).toThrow('incomplete');});

it('remeasures invalid regions once without relaxing the area limit',async()=>{
 const response=(input:unknown)=>({ok:true,json:async()=>({content:[{type:'tool_use',name:'record_source_template',input}],stop_reason:'tool_use'})});
 const invalid={...value,regions:[{x:0,y:0,width:1,height:1}]};
 const fetcher=vi.fn().mockResolvedValueOnce(response(invalid)).mockResolvedValueOnce(response(value));
 vi.stubGlobal('fetch',fetcher);
 vi.stubGlobal('AbortSignal',{timeout:()=>new AbortController().signal});
 try {
  expect((await selectReferenceTemplate({db:{},paths:['owned'],copy:'The headline',apiKey:'test'})).path).toBe('owned');
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockReset().mockResolvedValue(response(invalid));
  await expect(selectReferenceTemplate({db:{},paths:['owned'],copy:'The headline',apiKey:'test'})).rejects.toThrow('too much reconstruction');
  expect(fetcher).toHaveBeenCalledTimes(2);
 } finally {vi.unstubAllGlobals();}
});
