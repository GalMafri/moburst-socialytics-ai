import { CLEAN_VERDICT, validateDesignImage, verdictIsDirty } from "../_shared/design-prompts/validateImage.ts";

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
    const { image_data, media_type, expect_no_text } = await req.json();

    if (!image_data) {
      return jsonResp({ error: "image_data is required" }, 400);
    }

    const verdict = await validateDesignImage(image_data, { mediaType: media_type });
    // The client decides what counts; it gets the raw answers plus the two views of them.
    const dirty = verdictIsDirty(verdict, { expectNoText: expect_no_text === true });
    return jsonResp({ ...verdict, dirty });
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
