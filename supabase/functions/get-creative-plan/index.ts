import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { AuthzError, requireStaff } from '../_shared/auth/requireStaff.ts';
import { loadCreativePlan } from '../_shared/design-prompts/loadCreativePlan.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** The saved creative direction with signed reference previews, so the app can finish artwork the server completed. */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { plan_id, client_id } = await req.json();
    if (!plan_id || !client_id) return json({ error: 'plan_id and client_id are required' }, 400);
    await requireStaff(req, { writeClientId: client_id });
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const creative = await loadCreativePlan(db, plan_id, client_id);
    const { data: client } = await db.from('clients').select('logo_url,brand_identity').eq('id', client_id).maybeSingle();
    const previews = await Promise.all(creative.reference_paths.map(async (p: string) => {
      const { data, error } = await db.storage.from('design-references').createSignedUrl(p, 3600);
      if (error) throw error; return data.signedUrl;
    }));
    return json({ id: creative.id, mode: creative.mode, platform: creative.platform, format: creative.format, ...creative.plan, reference_previews: previews, logo_url: client?.logo_url || null, font_family: client?.brand_identity?.font_family || 'Arial' });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    return json({ error: err instanceof Error ? err.message : 'The creative direction could not be loaded.' }, 500);
  }
});
