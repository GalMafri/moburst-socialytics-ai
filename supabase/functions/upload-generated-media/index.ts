import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const { client_id, media_data, media_type, file_name } = await req.json();
    // media_data: base64 data URL (for images) or a remote URL (for videos)
    // media_type: "image" or "video"

    if (!client_id || !media_data) {
      return jsonResp({ error: "client_id and media_data are required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const timestamp = Date.now();
    const type = media_type || "image";
    const ext = type === "video" ? "mp4" : "png";
    const storagePath = `${client_id}/${timestamp}-${file_name || type}.${ext}`;
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
      const response = await fetch(media_data);
      if (!response.ok) {
        return jsonResp(
          { error: `Failed to download media: ${response.status}` },
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
      // If bucket doesn't exist, try to create it
      if (
        uploadError.message?.includes("not found") ||
        uploadError.message?.includes("Bucket")
      ) {
        // Try creating the bucket
        await supabase.storage.createBucket(bucket, {
          public: true,
          fileSizeLimit: 52428800, // 50MB
        });
        // Retry upload
        const { error: retryError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, fileBlob, {
            contentType,
            upsert: true,
          });
        if (retryError) {
          return jsonResp(
            { error: `Upload failed after bucket creation: ${retryError.message}` },
            500,
          );
        }
      } else {
        return jsonResp({ error: `Upload failed: ${uploadError.message}` }, 500);
      }
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
    console.error("upload-generated-media error:", err);
    return jsonResp({ error: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
