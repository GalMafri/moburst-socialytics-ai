import {supabase} from '@/integrations/supabase/client';
import {loadImage} from './composeText';
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
  const pixels=await loadImage(image);
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,1500/Math.max(pixels.naturalWidth,pixels.naturalHeight));
  canvas.width=Math.round(pixels.naturalWidth*scale);canvas.height=Math.round(pixels.naturalHeight*scale);
  canvas.getContext('2d')!.drawImage(pixels,0,0,canvas.width,canvas.height);
  const reviewImage=canvas.toDataURL('image/jpeg',0.9);
  const {data,error}=await supabase.functions.invoke('validate-design-output',{body:{image_data:reviewImage,creative_plan_id:plan.id,creative_frame_index:index,client_id:clientId}});
  if(error||!data||data.skipped||data.error) throw new CreativeReviewError(`The brand review is unavailable. ${data?.reason || (error ? await describeInvokeError(error,data) : '')} This design was withheld.`,image);
  return data;
}
export async function renderCreative(plan:ProductionPlan,index:number,clientId:string,post:{copy?:string;platform?:string;format?:string},isCancelled=()=>false):Promise<string> {
  let correction='';
  for(let pass=0;pass<2;pass++) {
    let {data,error}=await supabase.functions.invoke('generate-post-image',{body:{client_id:clientId,creative_plan_id:plan.id,creative_frame_index:index,creative_correction:correction,post:{copy:post.copy},platform:post.platform,format:post.format,render_text:true}});
    if(error||data?.error) throw new Error(await describeInvokeError(error,data));
    if(data?.job_id) {
      const jobId=data.job_id,deadline=Date.now()+20*60*1000;
      let imageUrl:string|undefined;
      while(Date.now()<deadline) {
        if(isCancelled()) throw new Error("Image review cancelled; the submitted job can be resumed later.");
        await new Promise(r=>setTimeout(r,8000));
        const result=await supabase.functions.invoke('media-job-status',{body:{job_id:jobId}});
        if(result.error||!result.data) continue;
        if(result.data.status==='failed') throw new Error(result.data.error||'Image rendering failed.');
        if(result.data.status==='completed'&&result.data.image_url) {imageUrl=result.data.image_url;break;}
      }
      if(!imageUrl) throw new Error('This design is still queued. Reopen it to resume the existing job; no new generation is needed.');
      const prefix=supabase.storage.from('generated-media').getPublicUrl('').data.publicUrl;
      const stored=imageUrl.startsWith(prefix) ? {data:{url:imageUrl},error:null} : await supabase.functions.invoke('upload-generated-media',{body:{client_id:clientId,media_data:imageUrl,media_type:'image',file_name:`creative-${plan.id}-${index}-${pass}`}});
      if(stored.error||!stored.data?.url) throw new Error('The rendered design could not be stored. Reopen it to recover this job.');
      await supabase.from('media_jobs').update({output_url:stored.data.url}).eq('id',jobId);
      data={rendered_by:'reference_creative',image_url:stored.data.url};
    }
    if(data?.rendered_by!=='reference_creative'||!data.image_url) throw new Error('A new reference-backed design was not returned.');
    const verdict=await reviewCreative(data.image_url,plan,index,clientId);
    if(!verdictIsDirty(verdict)) return data.image_url;
    correction=verdictSummary(verdict);
    if(pass===1) {
      await supabase.from('media_jobs').update({status:'failed',error:`Brand review rejected the complete creative: ${correction}`}).eq('client_id',clientId).contains('input',{creative_plan_id:plan.id});
      throw new CreativeReviewError(`Brand review rejected this design: ${correction}`,data.image_url);
    }
  }
  throw new Error('The design could not be completed.');
}
