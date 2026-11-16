// supabase/functions/_shared/media/modelBusy.ts
//
// The image model at its rate limit or briefly down. Kept in a file of its
// own, with no imports, so the shared step-error rule (canva/stepError.ts)
// and its tests can name it without loading the model's client.

/** The image model is at its rate limit or briefly down; the step is tried again on a later pass. */
export class ModelBusy extends Error {}
