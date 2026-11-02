import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { staffGate } from "../_shared/auth/requireStaff.ts";
import { listCustomerGroups, listCustomerProfiles, SproutListError } from "../_shared/sprout/profiles.ts";
import { declinedProfiles, groupBrands, type BrandDecline } from "../_shared/sprout/brands.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const networkDisplayMap: Record<string, string> = {
  twitter: "Twitter/X",
  facebook: "Facebook",
  instagram: "Instagram",
  fb_instagram_account: "Instagram",
  linkedin: "LinkedIn",
  linkedin_company: "LinkedIn",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  threads: "Threads",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // This lists every social profile on the agency's Sprout account, with
  // handles and links. It ran with verify_jwt = false and no check of its own,
  // so an unauthenticated POST returned all 73 of them.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    // The same list the client lifecycle matches profiles from (_shared/sprout/profiles.ts).
    const [listed, groups, declines] = await Promise.all([listCustomerProfiles(), listCustomerGroups(), readDeclines()]);
    // A brand a person chose not to add as a client is marked on each of its profiles.
    const declined = declinedProfiles(groupBrands(listed, groups), declines);
    const profiles = listed.map((p) => ({
      ...p,
      // The page compares these with assignments as Sprout sends them: numbers.
      id: /^\d+$/.test(p.id) ? Number(p.id) : p.id,
      network_display: networkDisplayMap[(p.network_type || "").toLowerCase()] || p.network_type,
      declined: declined.has(p.id) ? { brand: declined.get(p.id)!.brand, declined_at: declined.get(p.id)!.declined_at } : null,
    }));

    const grouped: Record<string, typeof profiles> = {};
    for (const profile of profiles) {
      const network = profile.network_display;
      if (!grouped[network]) grouped[network] = [];
      grouped[network].push(profile);
    }

    // Grouped by brand, as the weekly Sprout onboarding groups them
    // (_shared/sprout/brands.ts: one Sprout group is one brand, named by the
    // group; profiles in no group by the lifecycle's name rule), so this list
    // and the job agree. Only active profiles.
    const groupedByClient: Record<string, typeof profiles> = {};
    for (const brand of groupBrands(listed, groups)) {
      const ids = new Set(brand.profiles.map((p) => String(p.id)));
      (groupedByClient[brand.name || "Unknown"] ??= []).push(...profiles.filter((p) => ids.has(String(p.id))));
    }

    return new Response(
      JSON.stringify({
        total_profiles: profiles.length,
        profiles,
        grouped_by_network: grouped,
        grouped_by_client: groupedByClient,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Sprout profiles error:", err);
    const status = err instanceof SproutListError ? err.status : 500;
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * The brands a person chose not to add as clients (sprout_brand_declines),
 * read with the service role once the caller is known to be staff. A read
 * that does not answer marks nothing: the list still shows every profile.
 */
async function readDeclines(): Promise<BrandDecline[]> {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data, error } = await db.from("sprout_brand_declines").select("id, sprout_group_id, profile_ids, brand, declined_at, note");
  if (error) {
    console.warn("[sprout-profiles] declined brands not read:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    id: String(r.id), sprout_group_id: r.sprout_group_id == null ? null : String(r.sprout_group_id),
    profile_ids: Array.isArray(r.profile_ids) ? r.profile_ids.map(String) : [], brand: String(r.brand ?? ""),
    declined_at: String(r.declined_at ?? ""), note: r.note ?? null,
  }));
}
