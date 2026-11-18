// Preview as a client: what the screens ask the role-preview function.
//
// A staff member can use Socialytics as a client user of one client until
// they choose Exit preview (supabase/functions/role-preview). While it is
// open the person really holds the client role, so nothing on the page can
// tell them from a real client except their own open row in role_previews,
// which each person may read for themselves. That one read is how the page
// knows to show the band and the Exit button; a real client has no row, so
// the function is never even asked on their behalf.

import { supabase } from "@/integrations/supabase/client";
import { invokeErrorCode } from "@/lib/invokeError";
import { sendQuietly } from "@/lib/quietSend";

export interface RolePreview {
  id: string;
  client_id: string | null;
  client_name: string;
  started_at: string;
  expires_at: string;
}

export interface RolePreviewState {
  /** The preview this person is in, or null. */
  preview: RolePreview | null;
  /** True when this check found a preview that had just ended by itself (8 hours passed, or the person signed in again). */
  ended: boolean;
}

export const ROLE_PREVIEW_KEY = ["role-preview"] as const;
export const NO_PREVIEW: RolePreviewState = { preview: null, ended: false };

/** The signed-in person's preview. The function is asked only when they have an open row. */
export async function fetchRolePreview(): Promise<RolePreviewState> {
  const { data: auth } = await supabase.auth.getSession();
  const me = auth?.session?.user?.id;
  if (!me) return NO_PREVIEW;
  const { data: open, error } = await supabase.from("role_previews").select("id").eq("user_id", me).is("ended_at", null).limit(1);
  if (error) throw error;
  if (!open?.length) return NO_PREVIEW;
  // The function also ends a preview that is over: one older than 8 hours,
  // or one a new sign-in has already replaced.
  const { data, error: statusError } = await supabase.functions.invoke("role-preview", { body: { action: "status" } });
  if (statusError) throw statusError;
  return { preview: (data?.preview as RolePreview | null) ?? null, ended: !!data?.ended };
}

/** The preview that is now open, or null with the reason code the function gave for not starting one. */
export interface StartResult { preview: RolePreview | null; code: string | null }

/** Start a preview of one client. An answer that a preview is already open counts as started: it is. */
export async function startRolePreview(clientId: string): Promise<StartResult> {
  const { data, error } = await sendQuietly(() => supabase.functions.invoke("role-preview", { body: { action: "start", client_id: clientId } }));
  if (!error && data?.preview) return { preview: data.preview as RolePreview, code: null };
  const code = error ? await invokeErrorCode(error) : null;
  if (code === "already_previewing") {
    const now = await fetchRolePreview().catch(() => NO_PREVIEW);
    if (now.preview) return { preview: now.preview, code: null };
  }
  console.warn("[client preview] not started", code ?? error ?? "no preview in the answer");
  return { preview: null, code };
}

/**
 * Leave the preview. True when the function answered that the preview is
 * over: it ended it now, or found none to end. Either way the caller then
 * reads the person's role and preview again from the server and assumes
 * nothing. False when the function did not answer: nothing is known, and the
 * person is told they are still in the preview.
 */
export async function stopRolePreview(): Promise<{ ok: boolean }> {
  const { error } = await sendQuietly(() => supabase.functions.invoke("role-preview", { body: { action: "stop" } }));
  if (!error) return { ok: true };
  const code = await invokeErrorCode(error);
  if (code === "no_preview") return { ok: true };
  console.warn("[client preview] not left yet", code ?? error);
  return { ok: false };
}

/** What the dialog says when a preview did not start. The state of things, never a fault. */
export function notStartedSentence(code: string | null): string {
  if (code === "client_not_found" || code === "client_archived") return "That client is no longer available. Choose another client.";
  return "The preview has not started. To try again, choose Start.";
}
