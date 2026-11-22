// One job's row (canva_finish_jobs) behind a fake admin client, for tests
// that run a worker's step through an outage: every update the workers make
// is applied to the row the way the database applies it, only while the
// row's status is among those the statement names and every other condition
// of the statement holds on the row as it is when the statement runs (a
// column, or a text read out of the state with `state->>key`). A statement
// that asks for the rows it changed (`select`) is answered with them.

export type JobRow = {
  id: string; client_id: string; status: string; step: string; state: Record<string, unknown>; attempts: number;
  error: string | null; lease_until: string | null; output_path: string | null;
  input: Record<string, unknown>; design_request_id: string | null; option_index: number | null; slide_index: number | null; created_at: string;
};

/** One statement as it was sent: its values, its conditions beyond the row's id and statuses, whether it asked for the changed rows, and whether it changed the row. */
export type Statement = { values: Record<string, unknown>; conditions: Array<[string, string, unknown]>; select: boolean; landed: boolean };

/** What the database reads from the row for a condition's column: a column's value, or the text of a key of the state. */
function valueOf(row: JobRow, column: string): unknown {
  const key = /^state->>(.+)$/.exec(column)?.[1];
  if (!key) return (row as unknown as Record<string, unknown>)[column];
  const v = row.state?.[key];
  return v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v);
}

export function jobRow(init: Partial<JobRow> = {}) {
  const row: JobRow = {
    id: "job-1", client_id: "c1", status: "running", step: "title", state: {}, attempts: 0,
    error: null, lease_until: null, output_path: null,
    input: {}, design_request_id: "req-1", option_index: 0, slide_index: null, created_at: new Date().toISOString(),
    ...init,
  };
  /** Every update that reached the row, in order. */
  const updates: Array<Record<string, unknown>> = [];
  /** Every update that was sent, in order, whether it reached the row or not. */
  const statements: Statement[] = [];
  const admin = {
    from(table: string) {
      if (table !== "canva_finish_jobs") throw new Error(`Unexpected table ${table}.`);
      return {
        update(values: Record<string, unknown>) {
          let id: unknown;
          let statuses: unknown[] | null = null;
          const conditions: Array<[string, string, unknown]> = [];
          let select = false;
          const run = () => {
            const holds = id === row.id && (!statuses || statuses.includes(row.status))
              && conditions.every(([how, column, value]) => (how === "is" ? valueOf(row, column) === null : how === "not-is" ? valueOf(row, column) !== null : valueOf(row, column) === value));
            if (holds) {
              Object.assign(row, structuredClone(values));
              updates.push(values);
            }
            statements.push({ values, conditions, select, landed: holds });
            return select ? { data: holds ? [{ id: row.id }] : [], error: null } : { error: null };
          };
          const chain = {
            eq(column: string, value: unknown) { if (column === "id") id = value; else conditions.push(["eq", column, value]); return chain; },
            is(column: string, value: null) { conditions.push(["is", column, value]); return chain; },
            not(column: string, op: "is", value: null) { if (op === "is") conditions.push(["not-is", column, value]); return chain; },
            in(column: string, values: unknown[]) { if (column === "status") statuses = values; return chain; },
            select(_columns: string) { select = true; return chain; },
            then<T>(resolve: (r: { error: null; data?: Array<{ id: string }> }) => T, reject?: (e: unknown) => T) { return Promise.resolve().then(run).then(resolve, reject); },
          };
          return chain;
        },
      };
    },
  };
  /** The job as a pass reads it: its own copy of the row. */
  const read = () => ({
    id: row.id, client_id: row.client_id, step: row.step, state: structuredClone(row.state), attempts: row.attempts,
    input: row.input, design_request_id: row.design_request_id, option_index: row.option_index, slide_index: row.slide_index, created_at: row.created_at,
  });
  return { row, admin, updates, statements, read };
}
