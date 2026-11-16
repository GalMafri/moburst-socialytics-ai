import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { EmptyState } from "@/components/ui/empty-state";
import { compactNumber, eventName, formatDate, NO_DATA, timelineDetail, timelineKindName } from "@/lib/display";

/**
 * One person's full story: their own numbers and a chronological log of
 * everything they did.
 *
 * Deliberately not an aggregate. The population charts answer "how is the
 * product doing"; this answers "what happened to this user" — which is the
 * question you actually act on when a seat goes quiet.
 *
 * The timeline is built from work records, so it covers a user's whole history
 * rather than starting when event tracking shipped.
 */

/** kind says how a row reads: "date" is `at` (empty means never), "number" is `amount` (empty means no data), "text" is `value`. */
type DetailRow = { metric: string; tone: string; kind: "text" | "date" | "number"; value: string | null; at: string | null; amount: number | null };

/** What a row shows: dates in the viewer's time zone in the app's one date style, and numbers with the one shared rounding rule. */
function shown(d: DetailRow): string {
  if (d.kind === "date") return d.at ? formatDate(d.at) : "Never";
  if (d.kind === "number") return d.amount == null ? NO_DATA : compactNumber(Number(d.amount));
  return d.value ?? NO_DATA;
}
type TimelineRow = {
  at: string;
  kind: string;
  label: string;
  status: string | null;
  detail: string | null;
  entity_id: string | null;
  client_name: string | null;
};

const TONE: Record<string, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  plain: "text-foreground",
};

const KIND_STYLE: Record<string, string> = {
  run: "bg-info/15 text-info border-info/30",
  test: "bg-primary/15 text-primary border-primary/30",
  strategic: "bg-success/15 text-success border-success/30",
  post: "bg-success/15 text-success border-success/30",
  publish: "bg-success/15 text-success border-success/30",
  setup: "bg-muted text-muted-foreground border-border",
  event: "bg-warning/15 text-warning border-warning/30",
};

function when(iso: string) {
  const d = new Date(iso);
  return {
    date: formatDate(iso),
    time: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

export function UserDetail({
  email,
  name,
  onClose,
}: {
  email: string | null;
  name?: string | null;
  onClose: () => void;
}) {
  const detail = useQuery({
    queryKey: ["usage", "user-detail", email],
    enabled: !!email,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_detail", { p_email: email! });
      if (error) throw error;
      return (data ?? []) as unknown as DetailRow[];
    },
  });

  const timeline = useQuery({
    queryKey: ["usage", "user-timeline", email],
    enabled: !!email,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_user_timeline", {
        p_email: email!,
        p_limit: 300,
      });
      if (error) throw error;
      return (data ?? []) as unknown as TimelineRow[];
    },
  });

  const rows = timeline.data ?? [];
  let lastDate = "";

  return (
    <Sheet open={!!email} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-left">
            {name || email}
            <span className="mt-0.5 block t-label font-normal text-muted-foreground">{email}</span>
          </SheetTitle>
        </SheetHeader>

        {/* One loading state for both reads. A read that did not answer keeps loading and tries again; it never claims the person did nothing. */}
        {detail.isError || timeline.isError ? (
          <LoadRetry
            context="user detail"
            error={detail.error ?? timeline.error}
            label="Loading activity"
            onRetry={() => {
              if (detail.isError) void detail.refetch();
              if (timeline.isError) void timeline.refetch();
            }}
            className="justify-center py-10"
          />
        ) : (
          (detail.isLoading || timeline.isLoading) && <Loading label="Loading activity" className="justify-center py-10" />
        )}

        {detail.data && detail.data.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border p-4 sm:grid-cols-3">
            {detail.data.map((d) => (
              <div key={d.metric} className="py-1">
                <div className="t-label uppercase tracking-wide text-muted-foreground">
                  {d.metric}
                </div>
                <div className={`t-body font-medium tabular-nums ${TONE[d.tone] ?? TONE.plain}`}>
                  {shown(d)}
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-2 t-body font-semibold">
          Activity{rows.length > 0 && <span className="ml-2 t-label font-normal text-muted-foreground">{rows.length} entries</span>}
        </h3>

        {timeline.isSuccess && rows.length === 0 && <EmptyState compact framed={false} icon={Users} title="No activity yet" />}

        <ol className="relative space-y-0 border-l border-border pl-4">
          {rows.map((r, i) => {
            const t = when(r.at);
            const newDay = t.date !== lastDate;
            lastDate = t.date;
            return (
              <li key={`${r.at}-${i}`} className="relative pb-4">
                <span
                  className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                    r.status === "failed" ? "bg-destructive" : "bg-primary"
                  }`}
                />
                {newDay && (
                  <div className="mb-1 t-label font-medium uppercase tracking-wide text-muted-foreground">
                    {t.date}
                  </div>
                )}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="t-label tabular-nums text-muted-foreground">{t.time}</span>
                  <Badge variant="outline" className={`${KIND_STYLE[r.kind] ?? ""} text-[13px]`}>
                    {timelineKindName(r.kind)}
                  </Badge>
                  {/* Event rows carry the event's key as their label; it is named here. */}
                  <span className="t-body">{r.kind === "event" ? eventName(r.label) : r.label}</span>
                  {r.status === "failed" && (
                    <span className="t-label font-medium text-destructive">did not finish</span>
                  )}
                </div>
                {(r.client_name || timelineDetail(r.kind, r.detail)) && (
                  <div className="mt-0.5 t-secondary">
                    {[r.client_name, timelineDetail(r.kind, r.detail)].filter(Boolean).join(" · ")}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </SheetContent>
    </Sheet>
  );
}
