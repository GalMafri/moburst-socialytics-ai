import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use the same token URL as the working sprout-profiles function
const TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";

async function getSproutToken(): Promise<string> {
  const clientId = Deno.env.get("SPROUT_CLIENT_ID");
  const clientSecret = Deno.env.get("SPROUT_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Sprout Social credentials not configured");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "organization_id",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Sprout Social token [${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("Failed to get Sprout Social token: " + JSON.stringify(data));
  }
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      client_id,
      report_id,
      profile_id,
      sprout_profile_id,
      platform,
      scheduled_time,
      post_content,
      media_url,
    } = await req.json();

    if (!sprout_profile_id || !scheduled_time || !post_content) {
      return new Response(
        JSON.stringify({ error: "sprout_profile_id, scheduled_time, and post_content are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: client } = await supabase
      .from("clients")
      .select("sprout_customer_id")
      .eq("id", client_id)
      .single();

    const customerId = client?.sprout_customer_id || "1676448";
    const token = await getSproutToken();

    const publishPayload: any = {
      profile_ids: [sprout_profile_id],
      text: post_content,
      send_time: scheduled_time,
    };

    // Attach media if URL provided (supports both https:// and data:image URLs)
    if (media_url) {
      try {
        const mediaResponse = await fetch(`${SPROUT_API_BASE}/${customerId}/media`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url: media_url }),
        });

        if (mediaResponse.ok) {
          const mediaData = await mediaResponse.json();
          const mediaId = mediaData.id || mediaData.data?.id;
          if (mediaId) {
            publishPayload.media = [{ id: mediaId }];
            console.log("Media attached:", mediaId);
          }
        } else {
          const errText = await mediaResponse.text();
          console.error("Media upload failed, scheduling without media:", errText);
        }
      } catch (e) {
        console.error("Media upload failed, scheduling without media:", e);
      }
    }

    const response = await fetch(`${SPROUT_API_BASE}/${customerId}/publishing/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(publishPayload),
    });

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(`Sprout API error: ${JSON.stringify(responseData)}`);
    }

    const { error: insertError } = await supabase.from("scheduled_posts").insert({
      client_id,
      report_id,
      sprout_post_id: responseData.id || responseData.data?.id || null,
      profile_id,
      platform,
      scheduled_time,
      status: "scheduled",
      post_content,
      media_url: media_url ? "attached" : null,
    });

    if (insertError) {
      console.error("Failed to save scheduled post:", insertError);
    }

    return new Response(JSON.stringify({ success: true, sprout_post: responseData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error scheduling post:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
