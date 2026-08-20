import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

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

type DetailRow = { metric: string; value: string; tone: string };
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
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-rose-400",
  plain: "text-foreground",
};

const KIND_STYLE: Record<string, string> = {
  run: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  test: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  strategic: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  post: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  publish: "bg-teal-500/15 text-teal-400 border-teal-500/30",
  setup: "bg-muted text-muted-foreground border-border",
  event: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function when(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
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
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{email}</span>
          </SheetTitle>
        </SheetHeader>

        {(detail.isLoading || timeline.isLoading) && (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {detail.data && detail.data.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border border-border p-4 sm:grid-cols-3">
            {detail.data.map((d) => (
              <div key={d.metric} className="py-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {d.metric}
                </div>
                <div className={`text-sm font-medium tabular-nums ${TONE[d.tone] ?? TONE.plain}`}>
                  {d.value}
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-2 text-sm font-semibold">
          Activity{rows.length > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{rows.length} entries</span>}
        </h3>

        {!timeline.isLoading && rows.length === 0 && (
          <p className="py-6 text-sm text-muted-foreground">
            This person has never done anything in the product. They exist as an account and
            nothing more.
          </p>
        )}

        <ol className="relative space-y-0 border-l border-border pl-4">
          {rows.map((r, i) => {
            const t = when(r.at);
            const newDay = t.date !== lastDate;
            lastDate = t.date;
            return (
              <li key={`${r.at}-${i}`} className="relative pb-4">
                <span
                  className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${
                    r.status === "failed" ? "bg-rose-400" : "bg-primary"
                  }`}
                />
                {newDay && (
                  <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t.date}
                  </div>
                )}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xs tabular-nums text-muted-foreground">{t.time}</span>
                  <Badge variant="outline" className={`${KIND_STYLE[r.kind] ?? ""} text-[10px]`}>
                    {r.kind}
                  </Badge>
                  <span className="text-sm">{r.label}</span>
                  {r.status === "failed" && (
                    <span className="text-xs font-medium text-rose-400">failed</span>
                  )}
                </div>
                {(r.client_name || r.detail) && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[r.client_name, r.detail].filter(Boolean).join(" · ")}
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
