// @vitest-environment node
// The Drive and Slides calls a deck makes, as Google documents them: a
// resumable import of the .pptx template as Google Slides, files.copy into
// the folder, permissions.create as writer with no notification email, the
// trash, and one batchUpdate. Retries on 429 and 5xx; no token in an error.
import { describe, expect, it } from "vitest";
import { googleApi } from "../../../functions/_shared/google/api";
import { copyFile, createFolder, importPptx, presentationUrl, shareAsEditor, trashFile } from "../../../functions/_shared/google/drive";
import { batchUpdate, getPresentation } from "../../../functions/_shared/google/slides";

const TOKEN = "ya29.access-token-value";
function fake(...answers: Array<{ status?: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ method: String(init?.method), url, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
    const a = answers.shift() ?? {};
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200, headers: a.headers });
  };
  return { api: googleApi(TOKEN, f, async () => {}), calls };
}

describe("Drive", () => {
  it("makes the folder, imports the template as Google Slides with a resumable upload, copies it and shares it with no email", async () => {
    const { api, calls } = fake({ body: { id: "folder" } }, { headers: { Location: "https://upload.example/session" } }, { body: { id: "tpl" } }, { body: { id: "copy" } }, { body: { id: "perm" } }, { body: { id: "copy" } });
    expect(await createFolder(api, "Socialytics strategy decks")).toBe("folder");
    expect(await importPptx(api, { name: "Template", folderId: "folder", bytes: new Uint8Array([1, 2, 3]) })).toBe("tpl");
    expect(await copyFile(api, "tpl", { name: "Acme | Social Strategy | Nov 2026", folderId: "folder" })).toBe("copy");
    await shareAsEditor(api, "copy", "neria@moburst.com");
    await trashFile(api, "copy");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST https://www.googleapis.com/drive/v3/files?fields=id",
      "POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
      "PUT https://upload.example/session",
      "POST https://www.googleapis.com/drive/v3/files/tpl/copy?fields=id",
      "POST https://www.googleapis.com/drive/v3/files/copy/permissions?sendNotificationEmail=false&fields=id",
      "PATCH https://www.googleapis.com/drive/v3/files/copy?fields=id",
    ]);
    expect(JSON.parse(String(calls[0].body))).toEqual({ name: "Socialytics strategy decks", mimeType: "application/vnd.google-apps.folder" });
    expect(JSON.parse(String(calls[1].body))).toEqual({ name: "Template", mimeType: "application/vnd.google-apps.presentation", parents: ["folder"] });
    expect(calls[1].headers["X-Upload-Content-Type"]).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
    expect(JSON.parse(String(calls[3].body))).toEqual({ name: "Acme | Social Strategy | Nov 2026", parents: ["folder"] });
    expect(JSON.parse(String(calls[4].body))).toEqual({ type: "user", role: "writer", emailAddress: "neria@moburst.com" });
    expect(JSON.parse(String(calls[5].body))).toEqual({ trashed: true });
    expect(calls.every((c) => c.headers.Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(presentationUrl("copy")).toBe("https://docs.google.com/presentation/d/copy/edit");
  });

  it("tries a rate limit again, and never puts the token in an error", async () => {
    const { api, calls } = fake({ status: 429 }, { body: { id: "f" } });
    expect(await createFolder(api, "x")).toBe("f");
    expect(calls).toHaveLength(2);
    const bad = fake({ status: 403, body: { error: { message: `token ${TOKEN} has no access` } } });
    const err = await createFolder(bad.api, "x").catch((e: Error) => e);
    expect((err as Error).message).toMatch(/answered 403/);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe("Slides", () => {
  it("reads a presentation and sends one batchUpdate", async () => {
    const { api, calls } = fake({ body: { slides: [] } }, { body: { replies: [{ replaceAllText: { occurrencesChanged: 1 } }] } });
    expect(await getPresentation(api, "p1")).toEqual({ slides: [] });
    expect(await batchUpdate(api, "p1", [{ replaceAllText: {} }])).toEqual([{ replaceAllText: { occurrencesChanged: 1 } }]);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["GET https://slides.googleapis.com/v1/presentations/p1", "POST https://slides.googleapis.com/v1/presentations/p1:batchUpdate"]);
  });
});
