// Terminal-state receiver for Higgsfield generations.
//
// Higgsfield POSTs {request_id, status, error, payload} here when a request
// reaches completed/failed/nsfw. Contract points that shape this function:
//   - must answer within 10 seconds
//   - deliveries retry for up to 2 hours on 5xx, so transient errors should
//     return 5xx and permanent ones 2xx/4xx
//   - DUPLICATES ARE EXPECTED: dedupe on request_id + terminal status
//   - output URLs die after ~7 days, so the media is copied into our own
//     generated-media bucket here, not later
//
// AUTH. Higgsfield does not sign webhooks. The URL registered with each
// submission carries ?t=<HIGGSFIELD_WEBHOOK_SECRET>; anything without the
// right token is rejected 401. The token gates writes to media_jobs (via the
// service role), so treat it like any other secret: env only, never
// app_settings. verify_jwt is off in config.toml because Higgsfield cannot
// present a Supabase JWT — same rationale as gos-auth-bridge.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // ── Shared-secret gate ──
  const secret = Deno.env.get("HIGGSFIELD_WEBHOOK_SECRET");
  if (!secret) {
    // Misconfiguration on our side; 500 so Higgsfield retries until fixed.
    console.error("[higgsfield-webhook] HIGGSFIELD_WEBHOOK_SECRET is not set");
    return new Response("not configured", { status: 500 });
  }
  const token = new URL(req.url).searchParams.get("t");
  if (token !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  let body: {
    request_id?: string;
    status?: string;
    error?: string | null;
    payload?: {
      images?: Array<{ url: string; content_type?: string }>;
      video?: { url: string; content_type?: string };
    } | null;
  };
  try {
    body = await req.json();
  } catch {
    return new Response("bad json", { status: 400 }); // permanent, no retry
  }

  const { request_id, status } = body;
  if (!request_id || !status || !TERMINAL.has(status)) {
    // Not the documented envelope — reject permanently rather than retry.
    return new Response("unexpected envelope", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Locate the job ──
  const { data: job, error: findErr } = await supabase
    .from("media_jobs")
    .select("id, client_id, kind, status")
    .eq("provider", "higgsfield")
    .eq("request_id", request_id)
    .maybeSingle();

  if (findErr) {
    console.error("[higgsfield-webhook] job lookup failed:", findErr.message);
    return new Response("lookup failed", { status: 500 }); // transient → retry
  }
  if (!job) {
    // Unknown request id. Could be a webhook for a request submitted by a
    // different environment sharing the key. Acknowledge so it stops retrying.
    console.warn("[higgsfield-webhook] no media_jobs row for request:", request_id);
    return new Response("unknown request", { status: 200 });
  }

  // ── Dedupe: only act on the first terminal delivery ──
  if (TERMINAL.has(job.status) || job.status === "timed_out") {
    return new Response("already terminal", { status: 200 });
  }

  // ── Failure paths: stamp and done ──
  if (status !== "completed") {
    await supabase
      .from("media_jobs")
      .update({ status, error: body.error || null })
      .eq("id", job.id)
      .not("status", "in", '("completed","failed","nsfw","canceled","timed_out")');
    return new Response("recorded", { status: 200 });
  }

  // ── Success: copy the media into our storage BEFORE stamping completed ──
  const mediaUrl = body.payload?.video?.url || body.payload?.images?.[0]?.url;
  if (!mediaUrl) {
    await supabase
      .from("media_jobs")
      .update({ status: "failed", error: "completed without media url" })
      .eq("id", job.id);
    return new Response("no media in payload", { status: 200 });
  }

  try {
    const dl = await fetch(mediaUrl);
    if (!dl.ok) throw new Error(`download ${dl.status}`);
    const contentType =
      dl.headers.get("content-type") ||
      (job.kind === "video" ? "video/mp4" : "image/jpeg");
    const bytes = new Uint8Array(await dl.arrayBuffer());

    const ext = contentType.includes("mp4")
      ? "mp4"
      : contentType.includes("png")
      ? "png"
      : "jpg";
    const path = `${job.client_id}/${Date.now()}-higgsfield-${job.kind}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("generated-media")
      .upload(path, bytes, { contentType, upsert: true });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: pub } = supabase.storage.from("generated-media").getPublicUrl(path);

    // Guarded update: a concurrent duplicate delivery loses this race and
    // matches zero rows, keeping the transition idempotent.
    await supabase
      .from("media_jobs")
      .update({ status: "completed", output_url: pub.publicUrl, error: null })
      .eq("id", job.id)
      .not("status", "in", '("completed","failed","nsfw","canceled","timed_out")');

    return new Response("stored", { status: 200 });
  } catch (e) {
    // Copy failed (network, storage). 5xx so Higgsfield retries — the CDN URL
    // is still alive for days, so a later retry can succeed.
    console.error("[higgsfield-webhook] media copy failed:", e);
    return new Response("copy failed", { status: 500 });
  }
});
