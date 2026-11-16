import { createClient } from "../_shared/supabase.ts";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { authzResponse } from "../_shared/auth/authz.ts";
import { fetchGeneratedMedia } from "../_shared/brand-references/mediaFetch.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Who is asking comes first: an unauthenticated caller gets 401 whatever
    // the body says, never a hint about what a valid body looks like.
    await requireStaff(req);
    const { client_id, media_data, media_type, file_name } = await req.json();
    // media_data: base64 data URL (for images) or a remote URL (for videos)
    // media_type: "image" or "video"

    if (!client_id || !media_data) {
      return jsonResp({ error: "client_id and media_data are required" }, 400);
    }
    if (!UUID.test(String(client_id))) {
      return jsonResp({ error: "Choose a client first." }, 400);
    }
    // Writes to storage with the service role, so the caller needs write
    // access to the client whose folder it writes to, not just a staff role.
    await requireStaff(req, { writeClientId: String(client_id) });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const timestamp = Date.now();
    const type = media_type || "image";
    const ext = type === "video" ? "mp4" : "png";
    // The name never carries a path: it could otherwise step into another client's folder.
    const safeName = String(file_name || type).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80);
    const storagePath = `${client_id}/${timestamp}-${safeName}.${ext}`;
    const bucket = "generated-media";

    let fileBlob: Blob;
    let contentType: string;

    if (media_data.startsWith("data:")) {
      // Base64 data URL — decode to blob
      const match = media_data.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        return jsonResp({ error: "Invalid data URL format" }, 400);
      }
      contentType = match[1];
      const base64 = match[2];
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      fileBlob = new Blob([bytes], { type: contentType });
    } else if (media_data.startsWith("http")) {
      // Remote URL — download and re-upload
      // Only our own storage and the generation provider's CDN, with every
      // redirect checked; anything else could be an address inside our network.
      const response = await fetchGeneratedMedia(media_data, new URL(Deno.env.get("SUPABASE_URL")!).hostname);
      if (!response.ok) {
        return jsonResp(
          { error: "The media could not be downloaded." },
          500,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      contentType =
        response.headers.get("content-type") ||
        (type === "video" ? "video/mp4" : "image/png");
      fileBlob = new Blob([arrayBuffer], { type: contentType });
    } else {
      return jsonResp(
        { error: "media_data must be a data URL or HTTP URL" },
        400,
      );
    }

    // Upload to storage
    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, fileBlob, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError.message);
      return jsonResp({ error: "The file could not be stored." }, 500);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(storagePath);

    return jsonResp({
      url: urlData.publicUrl,
      storage_path: storagePath,
      media_type: type,
    });
  } catch (err: any) {
    if (err instanceof AuthzError) return authzResponse(err, corsHeaders);
    console.error("upload-generated-media error:", err);
    return jsonResp({ error: err?.message === "Unsupported media host" ? "That media address is not supported." : "The media could not be stored." }, err?.message === "Unsupported media host" ? 400 : 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
