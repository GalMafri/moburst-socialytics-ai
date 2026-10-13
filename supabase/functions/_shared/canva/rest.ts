// supabase/functions/_shared/canva/rest.ts
//
// The Canva Connect REST calls the finishing job uses. Every one of them is a
// start-then-check job on Canva's side; the job function stores the job id
// and checks it on a later tick instead of waiting inside one request.

import { CanvaBusy, backoffMs } from "./pace.ts";

const API = "https://api.canva.com/rest/v1";

export type CanvaJob = { id: string; status: "in_progress" | "success" | "failed"; [k: string]: unknown };

/** Resends after a 429, with Canva's Retry-After or exponential backoff, before handing the step back to a later pass. */
const RATE_RETRIES = 3;
const MAX_RATE_WAIT_MS = 12_000;

async function call(token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, ...headers } };
  if (body instanceof Uint8Array) init.body = body as unknown as BodyInit;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(`${API}${path}`, init);
    if (resp.status === 429) {
      const wait = backoffMs(resp.headers.get("Retry-After"), attempt);
      await resp.body?.cancel();
      if (attempt >= RATE_RETRIES || wait > MAX_RATE_WAIT_MS) throw new CanvaBusy(wait, `${method} ${path.split("/")[1] ?? path}`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (resp.status >= 500) {
      await resp.body?.cancel();
      // Canva's own outage: resent with backoff, then waited out on a later pass.
      if (attempt >= RATE_RETRIES) throw new CanvaBusy(60_000, `${method} ${path.split("/")[1] ?? path}`, "unavailable for");
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const text = await resp.text();
    if (!resp.ok) throw new Error(`Canva ${method} ${path} ${resp.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
}

function nameMetadata(name: string): string {
  const bytes = new TextEncoder().encode(name);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return JSON.stringify({ name_base64: btoa(s) });
}

/** Upload image bytes as an asset in the connected account. Upload jobs finish in seconds, so this one waits. */
export async function uploadAsset(token: string, bytes: Uint8Array, name: string): Promise<string> {
  let job: CanvaJob = (await call(token, "POST", "/asset-uploads", bytes, {
    "Content-Type": "application/octet-stream",
    "Asset-Upload-Metadata": nameMetadata(name),
  })).job;
  for (let i = 0; i < 20 && job.status === "in_progress"; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    job = (await call(token, "GET", `/asset-uploads/${job.id}`)).job;
  }
  if (job.status !== "success") throw new Error(`Canva asset upload ${job.status}: ${JSON.stringify(job.error ?? {}).slice(0, 200)}`);
  return (job as any).asset.id as string;
}

/** Start Magic Layers on an uploaded image: a new design whose elements are separate, editable layers. */
export async function startImageToDesign(token: string, assetId: string, title: string): Promise<string> {
  return (await call(token, "POST", "/image-to-design-imports", { image: { asset_id: assetId }, title })).job.id;
}

export async function getImageToDesign(token: string, jobId: string): Promise<{ status: string; designId?: string; error?: string }> {
  const job = (await call(token, "GET", `/image-to-design-imports/${jobId}`)).job;
  return { status: job.status, designId: job.result?.design?.id, error: job.error ? `${job.error.code}: ${job.error.message}` : undefined };
}

/** A PNG export of the design's page at this size; `transparent` leaves the page background out. */
export async function startExport(token: string, designId: string, width: number, height: number, opts: { transparent?: boolean } = {}): Promise<string> {
  const format = { type: "png", width, height, ...(opts.transparent ? { transparent_background: true } : {}) };
  return (await call(token, "POST", "/exports", { design_id: designId, format })).job.id;
}

export async function getExport(token: string, jobId: string): Promise<{ status: string; url?: string; error?: string }> {
  const job = (await call(token, "GET", `/exports/${jobId}`)).job;
  return { status: job.status, url: job.urls?.[0], error: job.error ? `${job.error.code}: ${job.error.message}` : undefined };
}
