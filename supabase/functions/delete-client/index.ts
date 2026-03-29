import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { client_id } = await req.json();
    if (!client_id) {
      return new Response(JSON.stringify({ error: "client_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get client info for storage cleanup
    const { data: client } = await supabase
      .from("clients")
      .select("name, brand_book_file_path, design_references")
      .eq("id", client_id)
      .single();

    // Delete in dependency order
    await supabase.from("scheduled_posts").delete().eq("client_id", client_id);
    await supabase.from("report_schedules").delete().eq("client_id", client_id);
    await supabase.from("sprout_profiles").delete().eq("client_id", client_id);
    await supabase.from("client_users").delete().eq("client_id", client_id);
    await supabase.from("reports").delete().eq("client_id", client_id);
    await supabase.from("clients").delete().eq("id", client_id);

    // Clean up storage
    if (client?.brand_book_file_path) {
      await supabase.storage.from("brand-books").remove([client.brand_book_file_path]);
    }
    if (client?.design_references && Array.isArray(client.design_references)) {
      await supabase.storage.from("design-references").remove(client.design_references as string[]);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error deleting client:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
