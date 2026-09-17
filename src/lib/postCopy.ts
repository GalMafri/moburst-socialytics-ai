/**
 * The copy of a calendar post, without any schema field that leaked into it.
 *
 * The synthesis agent is told "EVERY post MUST include a 'language' field",
 * and for a long time the structured output schema had no such property. With
 * nowhere legal to put it the model wrote it into the one free-text field it
 * had, so copy arrived as "language: en\n3 things you must do...". Twenty
 * stored posts across two clients read that way, and the report page showed it
 * to clients.
 *
 * The schema now declares `language`, which is the real fix. This exists
 * because the model's output is not ours to trust: the same pressure applies
 * to every other field it is asked for, and the next one to leak should not
 * reach a client's post either.
 *
 * Deliberately narrow. Only a leading line of the form `<known field>: <short
 * value>` is removed, and only when it is a whole line, so ordinary copy that
 * opens with "Tip: keep it short" or "Fact: many Veterans qualify" is
 * untouched.
 */

/** The post fields in the calendar schema. Anything else is real copy. */
const LEAKED_FIELDS = [
  "language",
  "platform",
  "format",
  "pillar",
  "posting_time",
  "hashtags",
  "visual_direction",
  "ai_visual_prompt",
  "rationale",
];

const LEADING_FIELD = new RegExp(
  // start, optional space, one of the field names, a colon, a short value,
  // then the end of that line.
  `^[ \\t]*(?:${LEAKED_FIELDS.join("|")})[ \\t]*:[ \\t]*[^\\n]{0,60}(?:\\n|$)`,
  "i",
);

export function cleanPostCopy(raw: string | null | undefined): string {
  let out = String(raw ?? "");
  // A model that leaked one field often leaks two, so keep taking them off the
  // front until the text starts with something that is actually copy. Bounded
  // so a pathological input cannot spin.
  for (let i = 0; i < LEAKED_FIELDS.length && LEADING_FIELD.test(out); i++) {
    out = out.replace(LEADING_FIELD, "");
  }
  return out.trimStart();
}

/** The readable copy of a calendar post, whichever key it arrived under. */
export function postCopyOf(post: {
  copy?: string | null;
  caption_angle?: string | null;
  concept?: string | null;
} | null | undefined): string {
  return cleanPostCopy(post?.copy || post?.caption_angle || post?.concept || "");
}
