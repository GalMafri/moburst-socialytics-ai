// supabase/functions/_shared/openai/key.ts
//
// The OpenAI key every worker uses: the OPENAI_API_KEY secret, else the
// app_settings row openai_api_key.

export async function openaiKey(admin: any): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (key) return key;
  const { data } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  if (!data?.value) throw new Error("FINAL: No OpenAI key is configured.");
  return data.value as string;
}
