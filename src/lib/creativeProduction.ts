import {supabase} from '@/integrations/supabase/client';
import {finishBrandStatic} from './brandLogo';
import {loadImage} from './composeText';
import {describeInvokeError} from './invokeError';
import {verdictIsDirty, verdictSummary} from './designGuard';
import type {CreativePlan} from '../../supabase/functions/_shared/design-prompts/creativePlan';
export interface ProductionPlan extends CreativePlan {
  id:string;
  client_id?:string;
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
export interface ProducedIteration { id: string; media_urls: string[]; frames: number[]; finishing?: string; variant_angle?: string | null }
export interface FrameProgress { index: number; state: 'rendering'|'reviewing'|'approved'|'failed'; attempt: number; url: string|null; preview: string|null; error: string|null }

/** Which plan frame a saved design row came from. */
export function frameIndexFor(plan: ProductionPlan, row: { variant_angle?: string|null }, position: number): number {
  const angle = String(row.variant_angle || '');
  const exact = /^Reference creative [0-9a-f-]{36}$/.test(angle);
  if (exact) return position;
  const found = plan.frames.findIndex(f => angle.endsWith(f.subject.slice(0, 80)));
  return found >= 0 ? found : position;
}

/** Set the brand system on server-completed artwork and save the finished design. */
export async function finishIterations(iterations: ProducedIteration[], plan: ProductionPlan, post: {platform?: string; format?: string}): Promise<string[]> {
  const all: string[] = [];
  for (const it of iterations) {
    if (it.finishing === 'done') { all.push(...(it.media_urls || [])); continue; }
    const finished: string[] = [];
    for (let i = 0; i < (it.media_urls || []).length; i++) {
      const index = it.frames?.[i] ?? frameIndexFor(plan, it, i);
      const dataUrl = await finishBrandStatic(it.media_urls[i], plan, index, post);
      const blob = await (await fetch(dataUrl)).blob();
      const path = `${plan.client_id || 'client'}/${Date.now()}-finished-${it.id}-${i}.png`;
      const { error } = await supabase.storage.from('generated-media').upload(path, blob, { contentType: 'image/png', upsert: true });
      if (error) throw new Error('The finished design could not be stored.');
      finished.push(supabase.storage.from('generated-media').getPublicUrl(path).data.publicUrl);
    }
    const { error } = await supabase.from('post_iterations').update({ media_urls: finished, finishing: 'done' }).eq('id', it.id);
    if (error) throw new Error('The finished design could not be saved.');
    all.push(...finished);
  }
  return all;
}

/**
 * Run a plan to completion. The server owns the run (submission, collection,
 * review, retries and the design record); this only follows it and applies
 * the finishing. Closing the page does not stop the run.
 */
export async function produceCreative(plan: ProductionPlan, clientId: string, post: {copy?: string; platform?: string; format?: string}, opts: { onProgress?: (approved: number, total: number, frames: FrameProgress[]) => void; isCancelled?: () => boolean } = {}): Promise<string[]> {
  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    if (opts.isCancelled?.()) throw new Error('Cancelled here; the run continues on the server and its designs will appear on this post.');
    const { data, error } = await supabase.functions.invoke('advance-creative-plan', { body: { plan_id: plan.id, client_id: clientId } });
    if (error || !data || data.error) throw new Error(await describeInvokeError(error, data));
    const frames: FrameProgress[] = data.frames || [];
    opts.onProgress?.(frames.filter(f => f.state === 'approved').length, data.count || frames.length, frames);
    if (data.failed) {
      const failed = frames.find(f => f.state === 'failed');
      throw new CreativeReviewError(failed?.error || 'The design could not be completed.', failed?.preview || '');
    }
    if (data.done) return await finishIterations(data.iterations || [], { ...plan, client_id: clientId }, post);
    await new Promise(r => setTimeout(r, 8000));
  }
  throw new Error('This design is still rendering on the server. Reopen the post later; nothing is lost.');
}
