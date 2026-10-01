// A client's design system as the app reads it: built from the client's own
// posts by build-design-system, approved once, then every design is rendered
// from it on the server.
import { supabase } from '@/integrations/supabase/client';
import { describeInvokeError } from '@/lib/invokeError';

export interface DesignSystemTemplate {
  id: string; name: string; formats: string[]; hero: 'generated' | 'photo' | 'none';
  headline: { region: string; width_pct: number; max_lines: number };
  hero_region: string; card: boolean; frame: boolean; notes?: string;
}
export interface DesignSystemData {
  version: number;
  tokens: {
    font: { family: string; body_weight: number; casing: string };
    colors: { ink: string; surface: string; accent: string; background: string; frame?: string[] };
    card: { style: string; alpha: number };
    frame: { style: string; width_pct: number };
    logo: { asset_path: string; position: string; width_pct: { portrait: number; square: number; landscape: number } };
  };
  imagery: { style: string; subjects: string; never: string[] };
  templates: DesignSystemTemplate[];
  sources: string[];
  notes?: string;
}
export interface DesignSystemPreview { template_id: string; format: string; path: string; url: string; font_size?: number; lines?: number }
export interface ClientDesignSystem {
  id: string; client_id: string; version: number; status: 'draft' | 'approved' | 'retired';
  system: DesignSystemData; previews: DesignSystemPreview[]; built_from: string[];
  logo_url: string | null; approved_at: string | null; created_at: string;
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('build-design-system', { body });
  if (error || data?.error) throw new Error(await describeInvokeError(error, data));
  return data;
}

export async function fetchDesignSystems(clientId: string): Promise<ClientDesignSystem[]> {
  return (await call({ client_id: clientId, action: 'get' })).systems || [];
}
export async function buildDesignSystem(clientId: string): Promise<ClientDesignSystem> {
  return (await call({ client_id: clientId, action: 'build' })).system;
}
export async function approveDesignSystem(clientId: string, id: string): Promise<ClientDesignSystem> {
  return (await call({ client_id: clientId, action: 'approve', id })).system;
}

/** The system designs render from (approved), and the newest draft waiting for a look. */
export function currentSystems(systems: ClientDesignSystem[]): { approved: ClientDesignSystem | null; draft: ClientDesignSystem | null } {
  const approved = systems.find((s) => s.status === 'approved') || null;
  const draft = systems.filter((s) => s.status === 'draft' && (!approved || s.created_at > approved.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null;
  return { approved, draft };
}
