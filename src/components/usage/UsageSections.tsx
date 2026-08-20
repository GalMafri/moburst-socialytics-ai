import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * Presentation for the behavioural sections of the usage page. Kept apart from
 * the page itself so Socialytics and AdVisor can render the same shapes over
 * their own event sets.
 */

export type MetricRow = { metric: string; value: number | null; sample: number };
export type FunnelRow = { step: string; step_order: number; users: number; events: number };
export type FeatureRow = {
  event: string;
  users: number;
  uses: number;
  failures: number;
  median_ms: number | null;
};

function fmt(n: number | null): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Funnel with per-step conversion, measured against the widest step. */
export function FunnelCard({ rows }: { rows: FunnelRow[] }) {
  const top = Math.max(1, ...rows.map((r) => r.users));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Journey drop-off</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No events in this window yet.</p>
        )}
        {rows.map((r, i) => {
          const prev = i > 0 ? rows[i - 1].users : r.users;
          const conv = prev > 0 ? Math.round((r.users / prev) * 100) : 0;
          const drop = prev - r.users;
          return (
            <div key={r.step}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span>{r.step}</span>
                <span className="tabular-nums text-muted-foreground">
                  {r.users} {r.users === 1 ? "person" : "people"}
                  {i > 0 && (
                    <span className={drop > 0 ? "ml-2 text-rose-400" : "ml-2 text-emerald-400"}>
                      {conv}%{drop > 0 ? ` · −${drop}` : ""}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(r.users / top) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

/** Generic metric list for the AI-quality / engagement / session blocks. */
export function MetricsCard({
  title,
  note,
  rows,
}: {
  title: string;
  note?: string;
  rows: MetricRow[];
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <dl className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.metric} className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-sm capitalize text-muted-foreground">{r.metric}</dt>
                <dd className="flex items-baseline gap-2">
                  <span className="text-base font-semibold tabular-nums">{fmt(r.value)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">n={r.sample}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {note && <p className="mt-3 text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

/** Every event the product emits, ranked by use. This is the adoption map. */
export function FeatureTable({ rows }: { rows: FeatureRow[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Feature adoption</CardTitle>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">People</TableHead>
                <TableHead className="text-right">Times</TableHead>
                <TableHead className="text-right">Failures</TableHead>
                <TableHead className="text-right">Median</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    No actions recorded yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.event}>
                  <TableCell className="font-mono text-xs">{r.event}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.users}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.uses}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.failures > 0 ? (
                      <span className="text-rose-400">{r.failures}</span>
                    ) : (
                      r.failures
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.median_ms == null ? "—" : `${(r.median_ms / 1000).toFixed(1)}s`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
