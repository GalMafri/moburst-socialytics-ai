// supabase/functions/_shared/media/modelBusy.ts
//
// The image model at its rate limit or briefly down. Kept in a file of its
// own, with no imports, so the shared step-error rule (canva/stepError.ts)
// and its tests can name it without loading the model's client.

/** The image model is at its rate limit or briefly down; the step is tried again on a later pass. */
export class ModelBusy extends Error {}

/**
 * The image model refused the request itself (a 4xx that is not its rate
 * limit): asking again the same way gets the same answer. Still an Error,
 * so every caller that does not look for it treats it as it always did. The
 * design worker looks for it on a design drawn in a platform's upload size
 * (_shared/design/sizeFallback.ts).
 */
export class ModelRefused extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
