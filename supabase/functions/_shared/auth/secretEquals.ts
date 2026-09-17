// Comparing a shared secret without telling the caller how close they got.
//
// `a !== b` on strings stops at the first differing byte, so the time it takes
// to answer depends on how many leading characters matched. Over enough
// requests that difference is measurable, and it turns guessing a secret from
// an impossible search of the whole space into a tractable one, character by
// character. These endpoints are world-reachable (verify_jwt is false for every
// function in this project) and the n8n workflows call them constantly, so a
// few thousand extra requests would not stand out.
//
// The digest comparison below always reads every byte of two equal-length
// arrays, so the answer takes the same time whether the first character was
// wrong or only the last one. Hashing first also means the lengths match even
// when the guess and the secret are different sizes, which would otherwise leak
// the length.

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

/**
 * True when `candidate` equals `secret`, in time that does not depend on how
 * much of it was right. A missing or empty secret is never equal to anything,
 * so a function whose env var failed to load refuses every caller rather than
 * accepting all of them.
 */
export async function secretEquals(
  candidate: string | null | undefined,
  secret: string | null | undefined,
): Promise<boolean> {
  if (!secret || !candidate) return false;

  const [a, b] = await Promise.all([sha256(candidate), sha256(secret)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
