// The client setup form as a view of the client row (self-serve design,
// section 1, 19 Oct 2026). The lifecycle fills these fields on its own and a
// person may change any of them; a trigger marks every field a save changes
// as set by a person (clients.field_sources), and the lifecycle never writes
// over those. So a save sends only what the person changed, compared with
// the values loaded from the database: a form opened before the lifecycle
// wrote a timezone must never pin the old one by sending it back.

import { rhythmSetting } from "@/lib/postingRhythm";

export interface Pillar {
  name: string;
  description: string;
}

export interface SetupForm {
  name: string;
  website_url: string;
  social_keywords: string[];
  content_pillars: Pillar[];
  strategy_doc_file_path: string;
  primary_platforms: string[];
  geo: string[];
  language: string[];
  brand_notes: string;
  brand_voice_preset: string;
  brand_book_text: string;
  brand_book_url: string;
  brand_book_file_path: string;
  logo_url: string;
  timezone: string;
  media_backend: string;
  design_references: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  brand_identity: Record<string, any> | null;
  brief_text: string;
  competitor_seed_notes: string;
  posting_rhythm: Record<string, string>;
}

/** A new client's form: a name and a website are all a person gives. Nothing else is filled in for them. */
export const EMPTY_FORM: SetupForm = {
  name: "", website_url: "", social_keywords: [], content_pillars: [], strategy_doc_file_path: "",
  primary_platforms: [], geo: [], language: [], brand_notes: "", brand_voice_preset: "", brand_book_text: "",
  brand_book_url: "", brand_book_file_path: "", logo_url: "",
  timezone: "",
  // Every client runs on Higgsfield (the column's own default).
  media_backend: "higgsfield",
  design_references: [], brand_identity: null, brief_text: "", competitor_seed_notes: "", posting_rhythm: {},
};

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);
const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The form's values from a client row. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formFromClient(client: Record<string, any>): SetupForm {
  const pillars: Pillar[] = Array.isArray(client.content_pillars)
    ? client.content_pillars.map((p: unknown) => (typeof p === "string" ? { name: p, description: "" } : { name: text((p as Pillar)?.name), description: text((p as Pillar)?.description) }))
    : [];
  let notes = text(client.brand_notes);
  let preset = "";
  const voice = notes.match(/^\[VOICE:(.+?)]\n?/);
  if (voice) {
    preset = voice[1];
    notes = notes.slice(voice[0].length);
  }
  return {
    name: text(client.name),
    website_url: text(client.website_url),
    social_keywords: list(client.social_keywords),
    content_pillars: pillars,
    strategy_doc_file_path: text(client.strategy_doc_file_path),
    primary_platforms: list(client.primary_platforms),
    geo: list(client.geo),
    language: list(client.language),
    brand_notes: notes,
    brand_voice_preset: preset,
    brand_book_text: text(client.brand_book_text),
    brand_book_url: text(client.brand_book_url),
    brand_book_file_path: text(client.brand_book_file_path),
    logo_url: text(client.logo_url),
    timezone: text(client.timezone),
    media_backend: text(client.media_backend) || "higgsfield",
    design_references: list(client.design_references),
    brand_identity: client.brand_identity && typeof client.brand_identity === "object" ? client.brand_identity : null,
    brief_text: text(client.brief_text),
    competitor_seed_notes: text(client.competitor_seed_notes),
    posting_rhythm: Object.fromEntries(Object.entries((client.posting_rhythm as Record<string, number> | null) ?? {}).map(([k, v]) => [k, String(v)])),
  };
}

/** The client columns the form stands for, as they are stored. */
export function columnsOf(form: SetupForm): Record<string, unknown> {
  return {
    name: form.name.trim(),
    website_url: form.website_url.trim(),
    social_keywords: form.social_keywords,
    content_pillars: form.content_pillars,
    strategy_doc_file_path: form.strategy_doc_file_path || null,
    primary_platforms: form.primary_platforms,
    geo: form.geo.join(","),
    language: form.language.join(","),
    brand_notes: form.brand_voice_preset ? `[VOICE:${form.brand_voice_preset}]\n${form.brand_notes}` : form.brand_notes,
    brand_book_text: form.brand_book_text,
    brand_book_url: form.brand_book_url || null,
    brand_book_file_path: form.brand_book_file_path || null,
    logo_url: form.logo_url || null,
    timezone: form.timezone || null,
    media_backend: form.media_backend || "higgsfield",
    design_references: form.design_references.length ? form.design_references : null,
    brand_identity: form.brand_identity,
    brief_text: form.brief_text,
    competitor_seed_notes: form.competitor_seed_notes,
    posting_rhythm: rhythmSetting(form.posting_rhythm),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Only the columns that differ between what was loaded and what the form holds now. */
export function changedColumns(loaded: SetupForm, now: SetupForm): Record<string, unknown> {
  const before = columnsOf(loaded);
  const after = columnsOf(now);
  return Object.fromEntries(Object.entries(after).filter(([k, v]) => !same(before[k], v)));
}

/**
 * The client row changed under an open form (the lifecycle read the website,
 * derived the pillars). Every field the person has not touched takes the new
 * value; every field they changed keeps their change.
 */
export function rebaseForm(form: SetupForm, loaded: SetupForm, next: SetupForm): SetupForm {
  const out = { ...form } as Record<keyof SetupForm, unknown>;
  for (const key of Object.keys(next) as Array<keyof SetupForm>) {
    if (same(form[key], loaded[key])) out[key] = next[key];
  }
  return out as unknown as SetupForm;
}

/** Keyword phrases from what a person typed: a comma starts the next phrase. */
export function keywordPhrases(typed: string, existing: string[]): string[] {
  const seen = new Set(existing.map((k) => k.toLowerCase()));
  const out: string[] = [];
  for (const phrase of typed.split(",").map((p) => p.trim()).filter(Boolean)) {
    if (seen.has(phrase.toLowerCase())) continue;
    seen.add(phrase.toLowerCase());
    out.push(phrase);
  }
  return out;
}

/** Who set a field, from clients.field_sources: "person", "lifecycle", "portal", or null when nobody did. */
export function setByOf(fieldSources: unknown, field: string): "person" | "lifecycle" | "portal" | null {
  const by = (fieldSources as Record<string, { by?: unknown }> | null | undefined)?.[field]?.by;
  return by === "person" || by === "lifecycle" || by === "portal" ? by : null;
}
