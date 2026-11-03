// Schedules one post to a client's Sprout profile, or publishes it now
// (Lital, 19 Oct 2026: staff schedule each post by hand; 2 Nov 2026: the
// dialog offers "Publish now" beside "Schedule"). The post is checked against what the
// network accepts before anything is sent (_shared/sprout/publishRules.ts,
// the same rules the scheduling dialog shows), so Sprout never refuses it,
// then sent as Sprout's Publishing API documents it (send.ts and
// _shared/sprout/publishing.ts). Sprout's API makes draft posts only: the
// post lands on Sprout's Publishing Calendar as a draft for its time. What
// the screen shows is the post's state: the scheduled_posts row this
// records, matched by the calendar post's key.

import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";
import { staffGate, requireStaff, AuthzError } from "../_shared/auth/requireStaff.ts";
import { sendToSprout, type SentStore } from "./send.ts";
import { storedStoryProblem } from "./story.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const WAITS_MS = [1_000, 3_000];
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // This publishes to a client's real social accounts through Sprout, so only staff may call it.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { client_id, report_id, sprout_profile_id, platform, scheduled_time, publish_now, post_content, media_url, media_urls, calendar_post_key } = await req.json();
    const allMediaUrls: string[] = media_urls?.length > 0 ? media_urls : media_url ? [media_url] : [];
    const publishNow = publish_now === true;
    if (!client_id || !sprout_profile_id || (!post_content && !allMediaUrls.length)) {
      return json({ error: "client_id, sprout_profile_id and the post are required" }, 400);
    }
    if (publishNow === !!scheduled_time) return json({ error: "Send either scheduled_time or publish_now: true" }, 400);

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

    // A Story is posted by hand: refused by the format the calendar holds for the post (story.ts), before Sprout is asked anything.
    const story = await storedStoryProblem(supabase, client_id, calendar_post_key);
    if (story) return json({ error: story, code: "not_publishable", problems: [story] }, 422);

    // The rows every screen reads: a post already sent is found, a sent post is written with retries.
    const store: SentStore = {
      async alreadySent({ clientId, calendarPostKey, status, at, since }) {
        let q = supabase.from("scheduled_posts").select("scheduled_time")
          .eq("client_id", clientId).eq("calendar_post_key", calendarPostKey).eq("status", status);
        if (at) q = q.eq("scheduled_time", at);
        if (since) q = q.gte("created_at", since);
        const { data } = await q.limit(1);
        return data?.[0]?.scheduled_time ? new Date(data[0].scheduled_time).toISOString().replace(".000Z", "Z") : null;
      },
      async record(row) {
        let insertError: { message: string; code?: string } | null = null;
        for (let attempt = 0; attempt <= WAITS_MS.length; attempt++) {
          ({ error: insertError } = await supabase.from("scheduled_posts").insert(row));
          // Before 20261019230000_setup_view.sql the column does not exist; the row is still written.
          if (insertError?.code === "42703" && "calendar_post_key" in row) { delete row.calendar_post_key; continue; }
          if (!insertError) break;
          if (attempt < WAITS_MS.length) await wait(WAITS_MS[attempt]);
        }
        if (insertError) console.error("The sent post could not be recorded:", insertError.message);
        return !insertError;
      },
    };

    const reply = await sendToSprout({
      clientId: client_id,
      reportId: report_id ?? null,
      calendarPostKey: calendar_post_key ?? null,
      profile: { rowId: assigned.id, sproutProfileId: Number(sprout_profile_id), networkType: assigned.network_type },
      platform: platform ?? null,
      text: String(post_content ?? ""),
      mediaUrls: allMediaUrls,
      scheduledTime: scheduled_time ?? null,
      publishNow,
      customerId: String(client.sprout_customer_id || defaultSproutCustomerId()),
      createdBy: caller.userId ?? null,
    }, store);
    return json(reply.body, reply.status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error scheduling post:", message);
    return json({ error: message }, error instanceof AuthzError ? error.status : 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
