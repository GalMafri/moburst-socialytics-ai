import {loadCreativePlan} from "../_shared/design-prompts/loadCreativePlan.ts";
import { sourceImage } from "../_shared/design-prompts/sourceImage.ts";
import { referencesFor } from "../_shared/design-prompts/designRefs.ts";
import { requireStaff } from "../_shared/auth/requireStaff.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CLEAN_VERDICT, validateDesignImage, verdictIsDirty } from "../_shared/design-prompts/validateImage.ts";
import { staffGate } from "../_shared/auth/requireStaff.ts";

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

  // Spends model credits on our key, so it cannot be world-invokable.
  const denied = await staffGate(req, corsHeaders);
  if (denied) return denied;

  try {
    const { image_data, media_type, expect_no_text, client_id, expected_text, reference_path, creative_plan_id, creative_frame_index = 0 } = await req.json();

    if (!image_data) {
      return jsonResp({ error: "image_data is required" }, 400);
    }

    let referenceImages:any[] = [], creativeText:string|undefined, creativeDirection:string|undefined;
    let video = false;
    if (creative_plan_id) {
      if (!client_id) throw new Error('Client required.');
      await requireStaff(req,{writeClientId:client_id});
      const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const creative=await loadCreativePlan(db,creative_plan_id,client_id);
      const frame=creative.plan.frames[creative_frame_index];
      if(!Number.isInteger(creative_frame_index)||!frame) throw new Error('Unknown creative scene.');
      referenceImages=await Promise.all(frame.reference_indices.map((i:number)=>sourceImage(db,creative.reference_paths[i])));
      creativeText=frame.headline; video=creative.mode==='video';
      if(!video && frame.layout) creativeDirection=JSON.stringify({subject:frame.subject,headline_position:frame.layout.headline_position,subject_position:frame.layout.subject_position});
    }
    let referenceImage: any = null;
    if (reference_path) {
      if (!client_id || typeof reference_path !== "string") return jsonResp({error:"A client and valid brand reference are required."},400);
      await requireStaff(req, {writeClientId: client_id});
      const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const {data} = await db.from("clients").select("design_references,harvested_design_references").eq("id",client_id).maybeSingle();
      if (!referencesFor(data?.design_references,data?.harvested_design_references,8).includes(reference_path)) return jsonResp({error:"Reference does not belong to this client."},403);
      referenceImage = await sourceImage(db, reference_path);
    }
    const avoid = referenceImage ? null : await antiPatternsFor(client_id);
    const verdict = await validateDesignImage(image_data, { mediaType: media_type, avoid, referenceImage, referenceImages, creative: !!creative_plan_id, video, creativeDirection, expectedText: creativeText || (typeof expected_text === "string" ? expected_text.slice(0, 500) : null) });
    // The client decides what counts; it gets the raw answers plus the two views of them.
    const dirty = verdictIsDirty(verdict, { expectNoText: expect_no_text === true });
    return jsonResp({ ...verdict, dirty, avoid: avoid || undefined });
  } catch (err: any) {
    console.error("validate-design-output error:", err.message);
    // Fail open on unexpected errors — never block a good design.
    return jsonResp({ ...CLEAN_VERDICT, skipped: true, reason: String(err.message || "Reference review failed.").slice(0,280) });
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
