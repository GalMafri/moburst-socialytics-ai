// supabase/functions/role-preview/preview.ts
//
// Preview as a client: what each request does, apart from the server so a
// test can run it against a stand-in for the database. Nothing here imports
// from https: or npm:.
//
// What a client user of one client is, in this database:
//   * user_roles holds exactly one row for the person, role 'client';
//   * client_users holds one row linking the person to that client;
//   * the person's profile names no company of its own (hub_company_name is
//     null and allowed_company_slugs is empty), so is_client_member() can
//     answer yes through the client link only, never through a company name
//     or a company list that would also match another client.
// A preview puts a staff member into exactly that state and nothing else.
// Every access rule in the database (is_admin, is_moburst_staff,
// is_client_member, can_access_client, can_write_client) reads those three
// places, so each one then answers for the person as for a real client.
//
// Every switch is ONE database function, so one transaction
// (migration 20261118120000_role_previews.sql). Nothing is decided here and
// then written there: the function locks the person's role rows, decides
// from what it reads under the lock, and writes everything together.
//
//   START (role_preview_begin). Only a person whose role, read under the
//   lock, is admin or moburst_user. The client must exist, must not be
//   archived, and a demo client is for admins only, as everywhere else. What
//   the person had is saved on a role_previews row; the profile's company
//   fields are cleared, the client link is set to this one client and the
//   role becomes 'client', all in that transaction.
//
//   STOP (role_preview_end, 'exited'). Only a person with an open
//   role_previews row. They hold the client role at that moment, so no staff
//   check can be used: the row, which only those two functions write, is the
//   proof. The role, the client links and the profile fields go back and the
//   row is closed, in one transaction.
//
//   SELF-HEALING. A sign-in through either Hub rewrites the person's role,
//   client links and profile from the Hub, and knows nothing about previews.
//   So role_preview_end first checks, under the lock, that the person is
//   still in the preview's exact state. If they are not, a sign-in or a
//   removal got there first: the row is closed and NOTHING is put back,
//   because what the Hub wrote is newer and correct. Status asks for that
//   check every time ('check'), and Start asks for it before it begins.
//
//   EXPIRY. A preview open for 8 hours or more is ended by the same check:
//   the person is put back exactly as Stop does it.
//
// Because each switch is one transaction, there is no state between the two
// sides: a person is a client exactly when they have an open row. When the
// database does not answer, nothing is assumed either way and the reply says
// the request did not go through; the page then asks for the status again.

/** How long a preview may stay open. The database ends it (role_preview_end); this is for the time the page is told. */
export const PREVIEW_MS = 8 * 60 * 60 * 1000;

export type EndedReason = "exited" | "expired" | "role_changed";

/** An open preview, as the page is told about it. Nothing of what was saved to put back. */
export interface OpenPreview {
  id: string;
  /** Null when the client was deleted while the preview was open. */
  client_id: string | null;
  client_name: string;
  started_at: string;
}

export type BeginCode = "started" | "already_previewing" | "not_staff" | "client_not_found" | "client_archived";

/** The three database calls a request makes. Each one throws when the database refuses or does not answer. */
export interface PreviewStore {
  /** The person's open preview row, or null. A read only. */
  openPreview(userId: string): Promise<OpenPreview | null>;
  /** role_preview_begin: the whole switch into a preview, in one transaction. */
  begin(userId: string, clientId: string): Promise<{ code: BeginCode; preview: OpenPreview | null }>;
  /** role_preview_end: 'exited' ends the preview now; 'check' ends it only if it is already over. */
  end(previewId: string, reason: "exited" | "check"): Promise<{ open: boolean; ended: EndedReason | null }>;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const refuse = (status: number, code: string, error: string): Reply => ({ status, body: { error, code } });

function view(preview: OpenPreview) {
  return {
    id: preview.id,
    client_id: preview.client_id,
    client_name: preview.client_name,
    started_at: preview.started_at,
    expires_at: new Date(Date.parse(preview.started_at) + PREVIEW_MS).toISOString(),
  };
}

/**
 * The person's preview after self-healing and expiry: the open one, or null
 * with the reason this very call ended it.
 */
async function current(store: PreviewStore, userId: string): Promise<{ preview: OpenPreview | null; ended: EndedReason | null }> {
  const preview = await store.openPreview(userId);
  if (!preview) return { preview: null, ended: null };
  const { open, ended } = await store.end(preview.id, "check");
  return { preview: open ? preview : null, ended };
}

/** Whether a preview is open for this person. */
export async function previewStatus(store: PreviewStore, userId: string): Promise<Reply> {
  const { preview, ended } = await current(store, userId);
  return { status: 200, body: { preview: preview ? view(preview) : null, ended } };
}

/** Start a preview of one client for a staff member. */
export async function startPreview(store: PreviewStore, userId: string, clientId: unknown): Promise<Reply> {
  if (typeof clientId !== "string" || !UUID.test(clientId)) return refuse(400, "client_required", "Choose a client to preview.");

  // A preview that is already over (8 hours, or a sign-in) is ended first, so it does not stand in the way.
  await current(store, userId);

  const { code, preview } = await store.begin(userId, clientId);
  if (code === "started" && preview) return { status: 200, body: { preview: view(preview), ended: null } };
  if (code === "already_previewing" && preview) {
    return { status: 409, body: { error: "You are already previewing as a client. Exit that preview first.", code, preview: view(preview) } };
  }
  if (code === "not_staff") return refuse(403, code, "Only Moburst staff can preview as a client.");
  if (code === "client_not_found") return refuse(404, code, "That client could not be found.");
  if (code === "client_archived") return refuse(409, code, "That client is archived, so there is nothing to preview.");
  // An answer this code does not know is never read as a start.
  throw new Error(`role_preview_begin answered ${JSON.stringify(code)}`);
}

/** End the caller's own preview and put them back as they were. */
export async function stopPreview(store: PreviewStore, userId: string): Promise<Reply> {
  const preview = await store.openPreview(userId);
  if (!preview) return refuse(409, "no_preview", "You are not in a preview.");
  // 'exited' when the person was put back; 'role_changed' when a sign-in had
  // already replaced the preview and nothing was put back; null when the row
  // was closed by another tab in the same moment. In each case the preview
  // is over and the page reads the person's role again.
  const { ended } = await store.end(preview.id, "exited");
  return { status: 200, body: { preview: null, ended } };
}

/** One request: {action: "start" | "stop" | "status", client_id?}. */
export async function handleRolePreview(
  store: PreviewStore,
  userId: string,
  body: { action?: unknown; client_id?: unknown },
): Promise<Reply> {
  try {
    if (body?.action === "status") return await previewStatus(store, userId);
    if (body?.action === "start") return await startPreview(store, userId, body.client_id);
    if (body?.action === "stop") return await stopPreview(store, userId);
    return refuse(400, "unknown_action", "Unknown action.");
  } catch (err) {
    // The database did not answer, or answered something unknown. Nothing is
    // claimed about which side the person is on: the page asks again.
    console.error("[role-preview] request failed:", err);
    return refuse(500, "unavailable", "This did not go through. Try again in a moment.");
  }
}
