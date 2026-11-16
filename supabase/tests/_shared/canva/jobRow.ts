// One job's row (canva_finish_jobs) behind a fake admin client, for tests
// that run a worker's step through an outage: every update the workers make
// is applied to the row the way the database applies it, only while the
// row's status is among those the statement names.

export type JobRow = {
  id: string; client_id: string; status: string; step: string; state: Record<string, unknown>; attempts: number;
  error: string | null; lease_until: string | null; output_path: string | null;
  input: Record<string, unknown>; design_request_id: string | null; option_index: number | null; created_at: string;
};

export function jobRow(init: Partial<JobRow> = {}) {
  const row: JobRow = {
    id: "job-1", client_id: "c1", status: "running", step: "title", state: {}, attempts: 0,
    error: null, lease_until: null, output_path: null,
    input: {}, design_request_id: "req-1", option_index: 0, created_at: new Date().toISOString(),
    ...init,
  };
  /** Every update that reached the row, in order. */
  const updates: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      if (table !== "canva_finish_jobs") throw new Error(`Unexpected table ${table}.`);
      return {
        update(values: Record<string, unknown>) {
          let id: unknown;
          let statuses: unknown[] | null = null;
          const run = () => {
            if (id === row.id && (!statuses || statuses.includes(row.status))) {
              Object.assign(row, structuredClone(values));
              updates.push(values);
            }
            return { error: null };
          };
          const chain = {
            eq(column: string, value: unknown) { if (column === "id") id = value; return chain; },
            in(column: string, values: unknown[]) { if (column === "status") statuses = values; return chain; },
            then<T>(resolve: (r: { error: null }) => T, reject?: (e: unknown) => T) { return Promise.resolve().then(run).then(resolve, reject); },
          };
          return chain;
        },
      };
    },
  };
  /** The job as a pass reads it: its own copy of the row. */
  const read = () => ({
    id: row.id, client_id: row.client_id, step: row.step, state: structuredClone(row.state), attempts: row.attempts,
    input: row.input, design_request_id: row.design_request_id, option_index: row.option_index, created_at: row.created_at,
  });
  return { row, admin, updates, read };
}
