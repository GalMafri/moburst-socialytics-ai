import {supabase} from '@/integrations/supabase/client';
import {finishBrandStatic} from './brandLogo';
import type {CreativePlan} from '../../supabase/functions/_shared/design-prompts/creativePlan';
export interface ProductionPlan extends CreativePlan {
  id:string;
  client_id?:string;
  reference_previews:string[];
  logo_url:string|null;
  font_family:string;
}
export interface ProducedIteration { id: string; media_urls: string[]; frames: number[]; finishing?: string; variant_angle?: string | null }

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
      if (error) throw new Error('The finished design was not stored.');
      finished.push(supabase.storage.from('generated-media').getPublicUrl(path).data.publicUrl);
    }
    const { error } = await supabase.from('post_iterations').update({ media_urls: finished, finishing: 'done' }).eq('id', it.id);
    if (error) throw new Error('The finished design was not saved.');
    all.push(...finished);
  }
  return all;
}
