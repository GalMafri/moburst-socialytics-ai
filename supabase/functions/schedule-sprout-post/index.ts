import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";

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

  // This publishes to a client's real social accounts through Sprout. It ran
  // with verify_jwt = false and no check of its own, so anyone who knew the
  // URL could schedule a post to any profile on the agency's account.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

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
      media_urls,
    } = await req.json();

    // Normalize: support both single media_url and array media_urls
    const allMediaUrls: string[] = media_urls?.length > 0
      ? media_urls
      : media_url ? [media_url] : [];

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

    const customerId = client?.sprout_customer_id || defaultSproutCustomerId();
    const token = await getSproutToken();

    const publishPayload: any = {
      profile_ids: [sprout_profile_id],
      text: post_content,
      send_time: scheduled_time,
    };

    // Attach media if URLs provided (supports both https:// and data:image URLs)
    const uploadedMedia: { id: string }[] = [];
    if (allMediaUrls.length > 0) {
      for (const url of allMediaUrls) {
        try {
          const mediaResponse = await fetch(`${SPROUT_API_BASE}/${customerId}/media`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ url }),
          });

          if (mediaResponse.ok) {
            const mediaData = await mediaResponse.json();
            const mediaId = mediaData.id || mediaData.data?.id;
            if (mediaId) {
              uploadedMedia.push({ id: mediaId });
              console.log("Media attached:", mediaId);
            }
          } else {
            const errText = await mediaResponse.text();
            console.error("Media upload failed for one item, continuing:", errText);
          }
        } catch (e) {
          console.error("Media upload failed for one item, continuing:", e);
        }
      }
      if (uploadedMedia.length > 0) {
        publishPayload.media = uploadedMedia;
      }
    }

    // Every attachment failure above was logged and stepped over, so a post
    // whose creative Sprout refused went out to the client's real account as
    // plain text while the person who scheduled it was told it worked. If
    // nothing survived, do not publish at all.
    const mediaRequested = allMediaUrls.length;
    const mediaDropped = mediaRequested - uploadedMedia.length;
    if (mediaRequested > 0 && uploadedMedia.length === 0) {
      return new Response(
        JSON.stringify({
          error:
            "Sprout would not accept the image or video for this post, so nothing was scheduled. " +
            "Publishing it as text only was almost certainly not what you wanted. Check the creative and try again.",
          media_requested: mediaRequested,
          media_attached: 0,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      media_url: allMediaUrls.length > 0 ? `${allMediaUrls.length} attached` : null,
    });

    // The post IS live in Sprout by this point, so a failed insert must not
    // read as a failed schedule. It is still worth saying out loud: without
    // the row, the calendar shows the post as merely approved and somebody
    // can queue it a second time.
    if (insertError) {
      console.error("Failed to save scheduled post:", insertError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sprout_post: responseData,
        recorded: !insertError,
        record_error: insertError ? insertError.message : null,
        // Partial attachment: some creative made it, some did not.
        media_requested: mediaRequested,
        media_attached: uploadedMedia.length,
        media_dropped: mediaDropped,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("Error scheduling post:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
