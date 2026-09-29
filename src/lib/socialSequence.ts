import { supabase } from '@/integrations/supabase/client';
import { applyReferenceTemplate } from './referenceTemplate';
import { verdictIsDirty, verdictSummary } from './designGuard';
import { describeInvokeError } from './invokeError';
import type { EditRegion, TemplateHeadline } from '../../supabase/functions/_shared/design-prompts/referenceTemplate';

export interface SocialTemplate {
  reference_preview_url: string;
  reference_path: string;
  template_regions: EditRegion[];
  template_headline: TemplateHeadline;
}

export function sequenceHeadlines(value: unknown, count: number): string[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error('The complete sequence could not be prepared. No partial draft was saved.');
  const words = value.map(slide => typeof slide?.headline === 'string' ? slide.headline.trim() : '');
  if (words.some(text => !text || text.length > 120 || text.split(/\s+/).length > 14) || new Set(words.map(text => text.toLowerCase())).size !== count) {
    throw new Error('Each frame needs a distinct, concise message that fits the original design.');
  }
  return words;
}

/** Only the copy is planned. The visual design comes from one actual social post. */
export async function planSocialSequence(copy: string, count: number, clientId: string, platform?: string): Promise<string[]> {
  const {data, error} = await supabase.functions.invoke('propose-carousel-slides', {
    body: {brief: copy, post_copy: copy, total: count, client_id: clientId, platform, source_template: true},
  });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  return sequenceHeadlines(data?.slides, count);
}

export async function prepareSocialTemplate(copy: string, clientId: string): Promise<SocialTemplate> {
  const {data, error} = await supabase.functions.invoke('generate-post-image', {
    body: {client_id: clientId, post: {copy}, render_text: true},
  });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  if (data?.rendered_by !== 'source_artwork' || !data?.reference_preview_url || !data?.reference_path || !data?.template_regions?.length || !data?.template_headline) {
    throw new Error('A reusable client social design is required. Refresh the automatic social references in Client Setup.');
  }
  return data as SocialTemplate;
}

export async function renderReviewedSocialFrame(template: SocialTemplate, copy: string, clientId: string): Promise<string> {
  const image = await applyReferenceTemplate(template.reference_preview_url, template.reference_preview_url, template.template_regions, template.template_headline, copy);
  const {data: verdict, error} = await supabase.functions.invoke('validate-design-output', {
    body: {image_data: image, reference_path: template.reference_path, expected_text: copy, client_id: clientId},
  });
  if (error || !verdict || verdict.skipped || verdict.error) throw new Error('Source comparison was unavailable. The draft was withheld.');
  if (verdictIsDirty(verdict)) throw new Error(`Source comparison rejected this frame: ${verdictSummary(verdict)}`);
  return image;
}
