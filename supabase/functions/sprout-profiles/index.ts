import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sprout_customer_id } = await req.json();

    if (!sprout_customer_id) {
      return new Response(JSON.stringify({ error: "sprout_customer_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sproutToken = Deno.env.get("SPROUT_SOCIAL_ACCESS_TOKEN");
    if (!sproutToken) {
      return new Response(JSON.stringify({ error: "Sprout Social access token not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch(
      `https://api.sproutsocial.com/v1/${sprout_customer_id}/metadata/customer`,
      {
        headers: {
          Authorization: `Bearer ${sproutToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Sprout API error: ${response.status}` }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const allProfiles = data.data || [];

    const networkDisplayMap: Record<string, string> = {
      twitter: "Twitter/X",
      facebook: "Facebook",
      instagram: "Instagram",
      linkedin: "LinkedIn",
      tiktok: "TikTok",
      youtube: "YouTube",
      pinterest: "Pinterest",
      threads: "Threads",
    };

    const profiles = allProfiles.map((p: any) => ({
      id: p.customer_profile_id,
      name: p.name || "",
      native_name: p.native_name || "",
      network_type: p.network_type || "",
      network_display: networkDisplayMap[(p.network_type || "").toLowerCase()] || p.network_type,
      native_link: p.native_link || "",
      status: p.status || "active",
    }));

    const grouped: Record<string, typeof profiles> = {};
    for (const profile of profiles) {
      const network = profile.network_display;
      if (!grouped[network]) grouped[network] = [];
      grouped[network].push(profile);
    }

    return new Response(
      JSON.stringify({
        total_profiles: profiles.length,
        profiles,
        grouped_by_network: grouped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
