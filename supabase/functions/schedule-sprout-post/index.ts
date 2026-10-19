// Schedules one post to a client's Sprout profile (Lital, 19 Oct 2026:
// staff schedule each post by hand). The post is checked against what the
// network accepts before anything is sent (_shared/sprout/publishRules.ts,
// the same rules the scheduling dialog shows), so Sprout never refuses it. A
// passing problem on Sprout's side (a rate limit, a busy gateway) is tried
// again here. What the screen shows is the post's state: the scheduled_posts
// row this records, matched by the calendar post's key.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";
import { publishProblems } from "../_shared/sprout/publishRules.ts";
import { staffGate, requireStaff, AuthzError } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Use the same token URL as the working sprout-profiles function
const TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";
const WAITS_MS = [1_000, 3_000];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A request to Sprout, sent again after a passing refusal. `resendOn` is the
 * set of statuses that mean Sprout did nothing with it; a network failure is
 * sent again only when `network` says the request is safe to repeat.
 */
async function sprout(url: string, init: RequestInit, opts: { resendOn: number[]; network: boolean }): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
      if (!opts.resendOn.includes(r.status) || attempt >= WAITS_MS.length) return r;
      await r.body?.cancel();
    } catch (e) {
      if (!opts.network || attempt >= WAITS_MS.length) throw e;
    }
    await wait(WAITS_MS[attempt]);
  }
}

async function getSproutToken(): Promise<string> {
  const clientId = Deno.env.get("SPROUT_CLIENT_ID");
  const clientSecret = Deno.env.get("SPROUT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Sprout Social credentials not configured");
  const response = await sprout(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope: "organization_id" }),
  }, { resendOn: [429, 500, 502, 503, 504], network: true });
  if (!response.ok) throw new Error(`Failed to get Sprout Social token [${response.status}]: ${await response.text()}`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Failed to get Sprout Social token: " + JSON.stringify(data));
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // This publishes to a client's real social accounts through Sprout, so only staff may call it.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { client_id, report_id, sprout_profile_id, platform, scheduled_time, post_content, media_url, media_urls, calendar_post_key } = await req.json();
    const allMediaUrls: string[] = media_urls?.length > 0 ? media_urls : media_url ? [media_url] : [];
    if (!client_id || !sprout_profile_id || !scheduled_time || (!post_content && !allMediaUrls.length)) {
      return json({ error: "client_id, sprout_profile_id, scheduled_time and the post are required" }, 400);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client } = await supabase.from("clients").select("sprout_customer_id").eq("id", client_id).single();
    const caller = await requireStaff(req, { writeClientId: client_id });
    if (!client) throw new AuthzError(404, "Client not found.");
    const { data: assigned, error: assignmentError } = await supabase.from("sprout_profiles")
      .select("id, network_type").eq("client_id", client_id)
      .eq("sprout_profile_id", sprout_profile_id).neq("is_active", false).maybeSingle();
    if (assignmentError) throw new Error("Could not verify the assigned publishing profile.");
    if (!assigned) throw new AuthzError(403, "That profile is not one of this client's accounts.");
    if (report_id) {
      const { data: report, error: reportError } = await supabase.from("reports").select("id").eq("id", report_id).eq("client_id", client_id).maybeSingle();
      if (reportError) throw new Error("Could not verify the report's client.");
      if (!report) throw new AuthzError(403, "The report does not belong to this client.");
    }

    // The network's own rules, checked before Sprout is asked.
    const problems = publishProblems({ network: assigned.network_type || platform, text: String(post_content ?? ""), mediaUrls: allMediaUrls, sendAt: scheduled_time });
    if (problems.length) return json({ error: problems.join(" "), code: "not_publishable", problems }, 422);

    // A post already scheduled for this calendar post and time is not sent twice.
    if (calendar_post_key) {
      const { data: already } = await supabase.from("scheduled_posts").select("id, scheduled_time")
        .eq("client_id", client_id).eq("calendar_post_key", calendar_post_key).eq("scheduled_time", scheduled_time).eq("status", "scheduled").limit(1);
      if (already?.length) return json({ success: true, already: true, recorded: true, scheduled_time });
    }

    const customerId = client.sprout_customer_id || defaultSproutCustomerId();
    const token = await getSproutToken();
    const publishPayload: Record<string, unknown> = { profile_ids: [sprout_profile_id], text: post_content ?? "", send_time: scheduled_time };

    // Each file goes to Sprout first. Sending a file again only makes another unused upload, so these repeat freely.
    const uploadedMedia: { id: string }[] = [];
    for (const url of allMediaUrls) {
      try {
        const mediaResponse = await sprout(`${SPROUT_API_BASE}/${customerId}/media`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        }, { resendOn: [429, 500, 502, 503, 504], network: true });
        if (mediaResponse.ok) {
          const mediaData = await mediaResponse.json();
          const mediaId = mediaData.id || mediaData.data?.id;
          if (mediaId) uploadedMedia.push({ id: mediaId });
        } else {
          console.error("Media upload refused:", mediaResponse.status, await mediaResponse.text());
        }
      } catch (e) {
        console.error("Media upload did not complete:", e);
      }
    }
    // Every file must make it: a post never goes out without the creative it was scheduled with.
    if (uploadedMedia.length < allMediaUrls.length) {
      return json({ error: "Sprout did not take every attached file, so nothing was scheduled.", code: "media_not_taken", media_requested: allMediaUrls.length, media_attached: uploadedMedia.length }, 502);
    }
    if (uploadedMedia.length) publishPayload.media = uploadedMedia;

    // The post itself is sent again only when Sprout said it did nothing (a rate limit, unavailable), never after a lost answer.
    const response = await sprout(`${SPROUT_API_BASE}/${customerId}/publishing/posts`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(publishPayload),
    }, { resendOn: [429, 503], network: false });
    const responseData = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Sprout API error ${response.status}: ${JSON.stringify(responseData).slice(0, 500)}`);

    // The post is in Sprout now; the row is what every screen reads, so it is written with retries.
    const row: Record<string, unknown> = {
      client_id, report_id: report_id ?? null, sprout_post_id: responseData.id || responseData.data?.id || null, profile_id: assigned.id,
      platform, scheduled_time, status: "scheduled", post_content, created_by: caller.userId ?? null,
      media_url: allMediaUrls.length > 0 ? `${allMediaUrls.length} attached` : null,
      ...(calendar_post_key ? { calendar_post_key } : {}),
    };
    let insertError: { message: string; code?: string } | null = null;
    for (let attempt = 0; attempt <= WAITS_MS.length; attempt++) {
      ({ error: insertError } = await supabase.from("scheduled_posts").insert(row));
      // Before 20261019230000_setup_view.sql the column does not exist; the row is still written.
      if (insertError?.code === "42703" && "calendar_post_key" in row) { delete row.calendar_post_key; continue; }
      if (!insertError) break;
      if (attempt < WAITS_MS.length) await wait(WAITS_MS[attempt]);
    }
    if (insertError) console.error("The scheduled post could not be recorded:", insertError.message);

    return json({ success: true, sprout_post: responseData, recorded: !insertError, scheduled_time, media_attached: uploadedMedia.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error scheduling post:", message);
    return json({ error: message }, error instanceof AuthzError ? error.status : 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
