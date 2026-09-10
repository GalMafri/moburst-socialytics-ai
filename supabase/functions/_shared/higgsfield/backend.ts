// supabase/functions/_shared/higgsfield/backend.ts
//
// Which provider renders a client's media.
//
// Read from the clients row with the service-role key and NEVER from the
// request body. generate-post-image and generate-post-video run with
// verify_jwt = false, and although both now require a signed-in staff member,
// letting the body pick the provider would still mean any caller could aim
// any client at the paid account. The column is the only say.

export type MediaBackend = "gemini" | "higgsfield";

export const DEFAULT_BACKEND: MediaBackend = "gemini";

/** Anything unrecognised is Gemini: an unknown value must not spend credits. */
export function asMediaBackend(value: unknown): MediaBackend {
  return value === "higgsfield" ? "higgsfield" : DEFAULT_BACKEND;
}

/**
 * The backend for one client.
 *
 * A client id that cannot be read falls back to Gemini rather than failing,
 * for the same reason: the safe default is the one already paid for.
 */
export async function mediaBackendFor(supabase: any, clientId: string | null | undefined): Promise<MediaBackend> {
  if (!clientId || !supabase) return DEFAULT_BACKEND;
  try {
    const { data, error } = await supabase.from("clients").select("media_backend").eq("id", clientId).maybeSingle();
    if (error) {
      console.warn("[media-backend] could not read the client's backend, using the default:", error.message);
      return DEFAULT_BACKEND;
    }
    return asMediaBackend(data?.media_backend);
  } catch (e) {
    console.warn("[media-backend] backend lookup threw, using the default:", e);
    return DEFAULT_BACKEND;
  }
}
