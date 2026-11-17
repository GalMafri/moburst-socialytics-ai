// supabase/functions/_shared/design/coverDesign.ts
//
// A slide's work belongs to the cover design it was drawn from, and a write
// for another cover design never lands (17 Nov 2026).
//
// A carousel's slides after the cover follow the cover's look. When the
// cover is made again, every other slide's row is started again
// (design-worker, designAgain). A run that still holds such a slide (its
// image call in flight, a step half done) read the row before that, and
// wrote its old step and state back over it when it ended: the carousel got
// a new cover with slides in the old cover's look, the old run's failure
// could fail the row, and its release of the lease let another pass take a
// row a newer run was working on.
//
// The rule has one value. A slide's row says which design of its cover it
// is for (`state.for_cover`): nothing from the start, which is the first,
// and one more each time the row is started again (`startAgain`, the one
// writer of it). Every write a run makes to a slide's row carries, in the
// same UPDATE statement, the value the run read (`forSameCover`): the
// database changes the row only while it still says that, so a write for
// another cover design changes nothing. The run that lost drops its work
// and writes nothing more; the row runs on from where it was started again.
// The comparison is on the row inside the statement, never a read followed
// by a write in the worker.
//
// The pictures follow the same rule: a row started again keeps its files
// in a folder of that cover design (`jobFolder`), so a picture stored late
// by the run that lost never takes the place of a newer run's.
//
// A job that follows no cover (a single design, a carousel's cover, a
// video) has no such value: its statements are built and run exactly as
// they were. Free of Deno and network imports: the workers and the tests
// share it.

/** The part of a job this reads: its place in its option, and its state as the run read it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CoverJob = { id: string; slide_index?: number | null; state?: any };

/** Where a slide's row says which design of its cover it is for. */
export const FOR_COVER = "for_cover";
const FOR_COVER_COLUMN = `state->>${FOR_COVER}`;

/** True for a job that follows a cover: a slide after the first of its option. These are the rows a cover made again starts again. */
export function followsCover(job: Pick<CoverJob, "slide_index">): boolean {
  return (job.slide_index ?? 0) > 0;
}

/** The design of its cover a slide's row is for, as the run read it: null for the first (a row never started again). No step changes it. */
function coverRead(job: CoverJob): number | null {
  const n = job.state?.[FOR_COVER];
  return typeof n === "number" ? n : null;
}

/**
 * What a slide's row becomes when its cover is made again: back at its
 * first step with nothing kept of the design it had (but which design on
 * the post it replaces), no lease, and for the cover's next design. `state`
 * is the row's state as the cover's run read it, `at` the time of the write.
 * This write is the one that is not compared with anything: the cover's new
 * design decides.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function startAgain(state: Record<string, any> | null | undefined, at: string): Record<string, unknown> {
  const was = typeof state?.[FOR_COVER] === "number" ? state[FOR_COVER] : 1;
  return {
    step: "generate", status: "running",
    state: { ...(state?.replaces ? { replaces: state.replaces } : {}), [FOR_COVER]: was + 1 },
    output_path: null, attempts: 0, error: null, lease_until: null, updated_at: at,
  };
}

/** The filters a statement on a job's row can take: an update as the workers build it (supabase-js). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Statement = { eq(column: string, value: unknown): any; is(column: string, value: null): any };

/**
 * An update of a job's row that changes it only while the row is for the
 * cover design the run read. `update` is the statement as its writer builds
 * it (the row's id, the statuses it holds for); for a slide after the cover
 * one more condition is added to that same statement, so the database
 * compares and writes in one step. For any other job the statement is
 * answered as it is.
 */
export function forSameCover<Q>(update: Q, job: CoverJob): Q {
  if (!followsCover(job)) return update;
  const read = coverRead(job);
  const statement = update as unknown as Statement;
  return read === null ? statement.is(FOR_COVER_COLUMN, null) : statement.eq(FOR_COVER_COLUMN, String(read));
}

/**
 * Runs an update of a job's row and says whether it landed. For a slide
 * after the cover the statement carries the cover design the run read and
 * names the row it changed: false is answered when the database changed no
 * row, which is a row started again for another cover design, or one
 * stopped meanwhile. The run then drops its work and writes nothing more.
 * When the database could not answer, nothing is known and true is
 * answered, so the run goes on as it always did; its later writes are
 * compared again. For any other job the statement is run as it always was
 * and true is answered.
 */
export async function landed<Q>(update: Q, job: CoverJob): Promise<boolean> {
  if (!followsCover(job)) {
    await update;
    return true;
  }
  const { data, error } = (await (forSameCover(update, job) as unknown as { select(columns: string): PromiseLike<{ data: unknown[] | null; error: unknown }> }).select("id")) ?? {};
  return error ? true : !!data?.length;
}

/**
 * The folder of a job's files. A slide's row started again for another
 * cover design keeps its files in a folder of that design: its designs are
 * counted from one again, so the names would be the same, and a picture
 * stored late by the run that lost would take the place of the newer run's.
 * Every other job's folder is the one it always was.
 */
export function jobFolder(job: CoverJob & { client_id: string }): string {
  const read = coverRead(job);
  return `${job.client_id}/canva-finish/${job.id}${read === null ? "" : `/cover-${read}`}`;
}
