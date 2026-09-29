import {describe,it,expect} from 'vitest';
import {clearSourceLettering} from '../lib/sourceLettering';
import type {TemplateHeadline} from '../../supabase/functions/_shared/design-prompts/referenceTemplate';
const headline:TemplateHeadline={x:.3,y:.32,width:.4,height:.2,font_family:'Arial',font_weight:400,font_size:.05,line_height:1.12,align:'center',color:'#ffffff',emphasis_words:2};
function fixture(darkInk=false){const data=new Uint8ClampedArray(200*250*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=darkInk?240:20;data[i+3]=255;}const paint=(x:number,y:number,w:number,h:number)=>{for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++){const p=(py*200+px)*4;data[p]=data[p+1]=data[p+2]=darkInk?10:245;}};for(const y of [85,110])for(const x of [70,85,100])paint(x,y,5,12);paint(15,10,20,10);return {data,width:200,height:250} as ImageData;}
describe('source lettering pixel measurement',()=>{
 it('corrects coarse coordinates from visible glyphs and preserves artwork outside lettering',()=>{const img=fixture();const before=img.data.slice();const h=clearSourceLettering(img,[{x:.25,y:.3,width:.5,height:.25}],headline);expect(h.y).toBeCloseTo(85/250-.009,3);expect(h.width).toBeLessThan(.3);expect(img.data[(85*200+70)*4]).toBe(20);expect(img.data.slice((10*200+15)*4,(10*200+35)*4)).toEqual(before.slice((10*200+15)*4,(10*200+35)*4));expect(h.font_size).toBeCloseTo(headline.font_size);});
 it('also handles dark lettering on a light source',()=>{const img=fixture(true);clearSourceLettering(img,[{x:.25,y:.3,width:.5,height:.25}],{...headline,color:'#000000'});expect(img.data[(85*200+70)*4]).toBe(240);});
 it('refuses an image area with no recognizable text instead of inventing a layout',()=>{const img=fixture();expect(()=>clearSourceLettering(img,[{x:.65,y:.65,width:.2,height:.2}],{...headline,x:.7,y:.7,width:.1,height:.1})).toThrow();});
});
