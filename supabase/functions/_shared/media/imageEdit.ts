// supabase/functions/_shared/media/imageEdit.ts
//
// One edit by the OpenAI image model: the given images and prompt, an
// optional mask, answered as a PNG at exactly the size asked for. Used by the
// design worker (designs and their cleanups) and the video worker (the kit).

import { decode as base64Decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { pngSize } from "../canva/jobs.ts";

export const OPENAI_IMAGE_MODEL = "gpt-image-2.5-flare";

/** The image model is at its rate limit or briefly down; the step is tried again on a later pass. */
export class ModelBusy extends Error {}

export async function imageEdit(apiKey: string, images: { bytes: Uint8Array; name: string }[], prompt: string, size: [number, number], mask?: Uint8Array): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", OPENAI_IMAGE_MODEL);
  form.append("size", `${size[0]}x${size[1]}`);
  form.append("quality", "high");
  form.append("n", "1");
  for (const im of images) {
    const type = /\.png$/i.test(im.name) ? "image/png" : /\.webp$/i.test(im.name) ? "image/webp" : "image/jpeg";
    form.append("image[]", new Blob([im.bytes as unknown as BlobPart], { type }), im.name);
  }
  if (mask) form.append("mask", new Blob([mask as unknown as BlobPart], { type: "image/png" }), "mask.png");
  form.append("prompt", prompt);
  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(360_000),
  });
  const text = await resp.text();
  if (resp.status === 429 || resp.status >= 500) throw new ModelBusy(`Image model ${resp.status}: ${text.slice(0, 200)}`);
  if (!resp.ok) throw new Error(`Image model ${resp.status}: ${text.slice(0, 300)}`);
  const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no image.");
  const bytes = base64Decode(b64);
  const [w, h] = pngSize(bytes, "The image model's answer");
  if (w !== size[0] || h !== size[1]) throw new Error(`The image model answered at ${w}x${h}; ${size[0]}x${size[1]} was asked for.`);
  return bytes;
}
