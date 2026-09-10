import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CLEAN_VERDICT, validateDesignImage, verdictIsDirty } from "../_shared/design-prompts/validateImage.ts";

/**
 * The brand's own "never" list, so the review can catch a design that is
 * clean of logos and lettering and still not theirs (the boardroom smile a
 * law firm's language forbids). Missing client or field → no extra rule.
 */
async function antiPatternsFor(clientId: unknown): Promise<string | null> {
  if (typeof clientId !== "string" || !clientId) return null;
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data } = await db.from("clients").select("design_style_synthesis").eq("id", clientId).maybeSingle();
    const s = (data as any)?.design_style_synthesis;
    // Only the brand's own "never" list. The imagery guidance is positive
    // direction and, read as rules, failed nearly every picture.
    const rules = typeof s?.anti_patterns === "string" ? s.anti_patterns.trim() : "";
    return rules || null;
  } catch {
    return null;
  }
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Reviews one generated design before it reaches a client.
 *
 * Returns `has_hex_codes` (unchanged meaning, existing callers keep working)
 * plus `has_logo` and `has_garbled_text`. The checks live in
 * _shared/design-prompts/validateImage.ts so the video generator can vet its
 * anchor frame with the same questions, without an HTTP hop.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_data, media_type, expect_no_text, client_id } = await req.json();

    if (!image_data) {
      return jsonResp({ error: "image_data is required" }, 400);
    }

    const avoid = await antiPatternsFor(client_id);
    const verdict = await validateDesignImage(image_data, { mediaType: media_type, avoid });
    // The client decides what counts; it gets the raw answers plus the two views of them.
    const dirty = verdictIsDirty(verdict, { expectNoText: expect_no_text === true });
    return jsonResp({ ...verdict, dirty, avoid: avoid || undefined });
  } catch (err: any) {
    console.error("validate-design-output error:", err.message);
    // Fail open on unexpected errors — never block a good design.
    return jsonResp({ ...CLEAN_VERDICT, skipped: true });
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
