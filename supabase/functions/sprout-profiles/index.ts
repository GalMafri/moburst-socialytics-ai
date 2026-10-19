import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";
import { listCustomerProfiles, SproutListError } from "../_shared/sprout/profiles.ts";

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
    const listed = await listCustomerProfiles();
    const profiles = listed.map((p) => ({
      ...p,
      // The page compares these with assignments as Sprout sends them: numbers.
      id: /^\d+$/.test(p.id) ? Number(p.id) : p.id,
      network_display: networkDisplayMap[(p.network_type || "").toLowerCase()] || p.network_type,
    }));

    const grouped: Record<string, typeof profiles> = {};
    for (const profile of profiles) {
      const network = profile.network_display;
      if (!grouped[network]) grouped[network] = [];
      grouped[network].push(profile);
    }

    // Group by client name (brand): each brand has multiple platform profiles.
    const groupedByClient: Record<string, typeof profiles> = {};
    for (const profile of profiles) {
      const clientName = profile.name || "Unknown";
      if (!groupedByClient[clientName]) groupedByClient[clientName] = [];
      groupedByClient[clientName].push(profile);
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
