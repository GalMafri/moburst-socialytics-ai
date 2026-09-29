import {supabase} from '@/integrations/supabase/client';
import {describeInvokeError} from './invokeError';
import {verdictIsDirty, verdictSummary} from './designGuard';
import type {CreativePlan} from '../../supabase/functions/_shared/design-prompts/creativePlan';
export interface ProductionPlan extends CreativePlan {
  id:string;
  reference_previews:string[];
  logo_url:string|null;
  font_family:string;
}
export async function planCreative(clientId:string, post:{copy?:string;platform?:string;format?:string}, mode:'single'|'carousel'|'video', count:number):Promise<ProductionPlan> {
  const {data,error}=await supabase.functions.invoke('plan-social-creative',{body:{client_id:clientId,copy:post.copy,platform:post.platform,format:post.format,mode,count}});
  if(error||data?.error) throw new Error(await describeInvokeError(error,data));
  if(!data?.id||data.frames?.length!==count||!data.reference_previews?.length) throw new Error('The reference-backed creative direction was incomplete.');
  return data;
}
export class CreativeReviewError extends Error {
  constructor(message:string,public readonly preview:string){super(message);}
}
export async function reviewCreative(image:string,plan:ProductionPlan,index:number,clientId:string) {
  const {data,error}=await supabase.functions.invoke('validate-design-output',{body:{image_data:image,creative_plan_id:plan.id,creative_frame_index:index,client_id:clientId}});
  if(error||!data||data.skipped||data.error) throw new CreativeReviewError('The brand review is unavailable. This design was withheld.',image);
  return data;
}
export async function renderCreative(plan:ProductionPlan,index:number,clientId:string,post:{copy?:string;platform?:string;format?:string}):Promise<string> {
  let correction='';
  for(let pass=0;pass<2;pass++) {
    const {data,error}=await supabase.functions.invoke('generate-post-image',{body:{client_id:clientId,creative_plan_id:plan.id,creative_frame_index:index,creative_correction:correction,post:{copy:post.copy},platform:post.platform,format:post.format,render_text:true}});
    if(error||data?.error) throw new Error(await describeInvokeError(error,data));
    if(data?.rendered_by!=='reference_creative'||!data.image_url) throw new Error('A new reference-backed design was not returned.');
    const verdict=await reviewCreative(data.image_url,plan,index,clientId);
    if(!verdictIsDirty(verdict)) return data.image_url;
    correction=verdictSummary(verdict);
    if(pass===1) throw new CreativeReviewError(`Brand review rejected this design: ${correction}`,data.image_url);
  }
  throw new Error('The design could not be completed.');
}
