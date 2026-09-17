import { staffGate } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Fetches any URL it is given and returns the bytes, which unauthenticated
  // is an open proxy running on our infrastructure.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { url } = await req.json();
    if (!url) {
      return new Response(JSON.stringify({ error: "url is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // A hung host used to hold this request until the platform killed it at
    // 150s, and a large file was read into memory whole and then again as a
    // base64 string, roughly 2.4x its size.
    const MAX_BYTES = 40 * 1024 * 1024;

    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch: ${response.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) {
      return new Response(
        JSON.stringify({
          error: `That file is ${Math.round(declared / 1024 / 1024)}MB, larger than the ${MAX_BYTES / 1024 / 1024}MB this can carry.`,
        }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const contentType = response.headers.get("content-type") || "video/mp4";
    const arrayBuffer = await response.arrayBuffer();
    // Hosts that send no content-length only get caught here.
    if (arrayBuffer.byteLength > MAX_BYTES) {
      return new Response(
        JSON.stringify({ error: "That file is too large to carry through this proxy." }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Convert to base64 data URL
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    // Process in chunks to avoid stack overflow on large files
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const chunk = uint8.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    const dataUrl = `data:${contentType};base64,${base64}`;

    return new Response(JSON.stringify({ data_url: dataUrl, size: uint8.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
