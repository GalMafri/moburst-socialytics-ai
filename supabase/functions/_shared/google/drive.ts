// supabase/functions/_shared/google/drive.ts
//
// The Drive API calls a deck needs, as Google documents them
// (https://developers.google.com/workspace/drive/api/reference/rest/v3):
// a folder, the template imported from .pptx as Google Slides (a resumable
// upload, since the template is over 5 MB), a copy per deck, the share to the
// person who asked (no email), and the trash for a copy that did not fill.

import type { GoogleApi } from "./api.ts";

export const DRIVE = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
export const SLIDES_MIME = "application/vnd.google-apps.presentation";
export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const presentationUrl = (id: string) => `https://docs.google.com/presentation/d/${encodeURIComponent(id)}/edit`;

export async function createFolder(api: GoogleApi, name: string): Promise<string> {
  const f = await api.json<{ id: string }>("POST", `${DRIVE}/files?fields=id`, { name, mimeType: "application/vnd.google-apps.folder" });
  return f.id;
}

/** A .pptx imported as a Google Slides file in a folder, with a resumable upload. */
export async function importPptx(api: GoogleApi, a: { name: string; folderId: string; bytes: Uint8Array }): Promise<string> {
  const start = await api.raw("POST", `${DRIVE_UPLOAD}?uploadType=resumable&fields=id`, {
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": PPTX_MIME, "X-Upload-Content-Length": String(a.bytes.byteLength) },
    body: JSON.stringify({ name: a.name, mimeType: SLIDES_MIME, parents: [a.folderId] }),
  });
  const session = start.headers.get("Location");
  if (!session) throw new Error("Drive answered the upload without its session link.");
  const done = await api.raw("PUT", session, { headers: { "Content-Type": PPTX_MIME }, body: a.bytes as unknown as BodyInit });
  const file = await done.json() as { id?: string };
  if (!file.id) throw new Error("Drive answered the upload without a file id.");
  return file.id;
}

export async function copyFile(api: GoogleApi, fileId: string, a: { name: string; folderId: string }): Promise<string> {
  const f = await api.json<{ id: string }>("POST", `${DRIVE}/files/${encodeURIComponent(fileId)}/copy?fields=id`, { name: a.name, parents: [a.folderId] });
  return f.id;
}

/** The person who asked, as an editor, with no Google email. */
export async function shareAsEditor(api: GoogleApi, fileId: string, email: string): Promise<void> {
  await api.json("POST", `${DRIVE}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&fields=id`, { type: "user", role: "writer", emailAddress: email });
}

export async function trashFile(api: GoogleApi, fileId: string): Promise<void> {
  await api.json("PATCH", `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id`, { trashed: true });
}

/** Whether the app's file is still there and not in the trash. */
export async function fileAlive(api: GoogleApi, fileId: string): Promise<boolean> {
  try {
    const f = await api.json<{ trashed?: boolean }>("GET", `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,trashed`);
    return f.trashed !== true;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return false;
    throw e;
  }
}
