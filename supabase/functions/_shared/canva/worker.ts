// supabase/functions/_shared/canva/worker.ts
//
// Starting a pass of the design worker (canva-finish's tick) right away,
// instead of waiting for the minute timer. Used by the worker to start its
// next pass, and by design-request once a request's first options exist.
//
// The worker answers at once and runs the pass in the background, so this
// call returns in well under a second. If it fails, the minute timer starts
// the worker instead.

export async function wakeWorker(): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!url || !secret) return;
  try {
    const res = await fetch(`${url}/functions/v1/canva-finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret },
      body: JSON.stringify({ action: "tick" }),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
  } catch (e) {
    console.warn("[canva-finish] could not start the next pass; the timer will:", e instanceof Error ? e.message : e);
  }
}
