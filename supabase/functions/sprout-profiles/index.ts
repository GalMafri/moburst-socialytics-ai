import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SPROUT_TOKEN_URL = 'https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token';
const SPROUT_API_BASE = 'https://api.sproutsocial.com/v1';
const DEFAULT_CUSTOMER_ID = '1676448';

async function getSproutAccessToken(): Promise<string> {
  const clientId = Deno.env.get("SPROUT_CLIENT_ID");
  if (!clientId) throw new Error("SPROUT_CLIENT_ID is not configured");

  const clientSecret = Deno.env.get("SPROUT_CLIENT_SECRET");
  if (!clientSecret) throw new Error("SPROUT_CLIENT_SECRET is not configured");

  const response = await fetch(SPROUT_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'organization_id',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to obtain Sprout access token [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const customerId = DEFAULT_CUSTOMER_ID;
    const accessToken = await getSproutAccessToken();

    const response = await fetch(
      `${SPROUT_API_BASE}/${customerId}/metadata/customer`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(JSON.stringify({ error: `Sprout API error [${response.status}]: ${errorText}` }), {
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
      fb_instagram_account: "Instagram",
      linkedin: "LinkedIn",
      linkedin_company: "LinkedIn",
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

    // Group by client name (brand) — each brand has multiple platform profiles
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
  } catch (err: any) {
    console.error("Sprout profiles error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
