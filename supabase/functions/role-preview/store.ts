// supabase/functions/role-preview/store.ts
//
// The three database calls a preview request makes (preview.ts
// PreviewStore), with the service role: one read of the person's open row,
// and the two functions that each make a whole switch in one transaction
// (role_preview_begin, role_preview_end). Nothing here writes a table: the
// role, the client links, the profile fields and the preview row are only
// ever changed inside those functions. Nothing here imports from https: or
// npm:, so a test can run it against a stand-in client.

import type { BeginCode, EndedReason, OpenPreview, PreviewStore } from "./preview.ts";

// The supabase-js client has no type this module can name without an https import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const BEGIN_CODES: readonly BeginCode[] = ["started", "already_previewing", "not_staff", "client_not_found", "client_archived"];
const ENDED: readonly EndedReason[] = ["exited", "expired", "role_changed"];

/** The data of an answer, or a thrown error naming what was being done. */
async function must<T>(what: string, call: PromiseLike<{ data?: T | null; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await call;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? null) as T | null;
}

/** A preview as the functions and the table give it, or null when a field is missing. */
export function readPreview(raw: unknown): OpenPreview | null {
  const p = raw as Partial<OpenPreview> | null;
  if (!p || typeof p.id !== "string" || typeof p.client_name !== "string" || !p.started_at) return null;
  const started = new Date(p.started_at);
  if (Number.isNaN(started.getTime())) return null;
  return { id: p.id, client_id: typeof p.client_id === "string" ? p.client_id : null, client_name: p.client_name, started_at: started.toISOString() };
}

/** What role_preview_begin answered. An answer that cannot be read is an error, never a start and never a refusal. */
export function readBegin(answer: unknown): { code: BeginCode; preview: OpenPreview | null } {
  const a = answer as { code?: unknown; preview?: unknown } | null;
  const code = BEGIN_CODES.find((c) => c === a?.code);
  if (!code) throw new Error(`begin preview: unreadable answer ${JSON.stringify(answer)}`);
  const preview = readPreview(a?.preview);
  if ((code === "started" || code === "already_previewing") && !preview) throw new Error(`begin preview: ${code} with no preview`);
  return { code, preview };
}

/** What role_preview_end answered. An answer that does not say whether the preview is open is an error. */
export function readEnd(answer: unknown): { open: boolean; ended: EndedReason | null } {
  const a = answer as { open?: unknown; ended?: unknown } | null;
  if (!a || typeof a.open !== "boolean") throw new Error(`end preview: unreadable answer ${JSON.stringify(answer)}`);
  return { open: a.open, ended: ENDED.find((r) => r === a.ended) ?? null };
}

export function previewStore(admin: Admin): PreviewStore {
  return {
    async openPreview(userId) {
      return readPreview(await must<unknown>("read preview", admin.from("role_previews").select("id, client_id, client_name, started_at").eq("user_id", userId).is("ended_at", null).maybeSingle()));
    },
    async begin(userId, clientId) {
      return readBegin(await must<unknown>("begin preview", admin.rpc("role_preview_begin", { p_user: userId, p_client: clientId })));
    },
    async end(previewId, reason) {
      return readEnd(await must<unknown>("end preview", admin.rpc("role_preview_end", { p_id: previewId, p_reason: reason })));
    },
  };
}
