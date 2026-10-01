// A client's social template library (version 2): templates read from the
// client's own posts by the server, one post per step, each kept only when
// its re-render reproduces the post. The panel drives the steps and shows
// every template next to the post it came from.
import { supabase } from '@/integrations/supabase/client';
import { describeInvokeError } from '@/lib/invokeError';

export interface TemplateSlot { role: string; x: number; y: number; w: number; h: number; size: number; maxLines: number; align: string; weight: number; color: string; face?: string; sample: string }
export interface SocialTemplate { id: string; name: string; source_path: string; score: number; width: number; height: number; format: string; slots: TemplateSlot[]; hero: { role: string; x: number; y: number; w: number; h: number } | null; preview_url?: string }
export interface LibraryBuild {
  queue: string[]; done: boolean; templates: SocialTemplate[]; rejected: Array<{ path: string; score: number }>; faces: Record<string, number>; logo_url: string | null;
  current: { path: string; round: number; score: number } | null;
  progress?: { kept: number; rejected: number; remaining: number; current: { path: string; round: number; score: number } | null };
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('build-social-templates', { body });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  return data;
}
export async function fetchLibraryBuild(clientId: string): Promise<{ id: string | null; build: LibraryBuild | null }> { return call({ client_id: clientId, action: 'get' }); }
export async function startLibraryBuild(clientId: string): Promise<{ id: string; build: LibraryBuild }> { return call({ client_id: clientId, action: 'start' }); }
export async function stepLibraryBuild(clientId: string): Promise<{ id: string; build: LibraryBuild }> { return call({ client_id: clientId, action: 'step' }); }
export async function approveLibrary(clientId: string, id: string): Promise<{ approved: string; templates: number }> { return call({ client_id: clientId, action: 'approve', id }); }

/** The public URL of a harvested post, for showing a template next to its source. */
export function postUrl(path: string): string { return supabase.storage.from('design-references').getPublicUrl(path).data.publicUrl; }

/** Faces in vote order, so the panel can name the brand's typeface(s). */
export function facesOf(build: LibraryBuild): string[] { return Object.entries(build.faces || {}).sort((a, b) => b[1] - a[1]).map(([f]) => f); }
