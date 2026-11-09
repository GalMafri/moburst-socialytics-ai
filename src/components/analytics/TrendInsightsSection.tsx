import { useMemo, useState } from "react";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Section } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/empty-state";
import { Loading } from "@/components/ui/loading";
import { LoadRetry } from "@/components/ui/load-error";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ThemeWeeks, useThemePlatformFilter } from "@/components/trends/TrendThemes";
import { useAuth } from "@/hooks/useAuth";
import { useDismissTrendTheme, useTrendThemes, type TrendTheme } from "@/hooks/useTrendThemes";

/**
 * The client's weekly industry themes for the weeks inside the window the
 * page is showing, each with the example posts behind it. A platform filter
 * narrows the list to one network. Moburst staff can dismiss a theme: it comes
 * off the list, and next week's collection leaves out anything like it.
 */
export function TrendInsightsSection({ clientId, from, to }: { clientId: string; from: string; to: string }) {
  const { isMoburstStaff } = useAuth();
  const { data, isLoading, isError, error, refetch } = useTrendThemes(clientId, from, to);
  const dismiss = useDismissTrendTheme(clientId);
  const [dismissing, setDismissing] = useState<TrendTheme | null>(null);

  const themes = useMemo(() => data?.themes ?? [], [data]);
  const { filter, shown } = useThemePlatformFilter(themes);

  return (
    <Section id="trends" title="Trend insights" description="Each week's industry themes, with the example posts behind them." action={filter || undefined}>
      {isLoading ? (
        <Loading label="Loading trends" />
      ) : isError ? (
        // Themes that did not answer are no claim about the client's trends: keep loading, quietly, and fill in when a try answers.
        <LoadRetry context="trend themes" error={error} label="Loading trends" onRetry={() => refetch()} />
      ) : shown.length === 0 ? (
        // Nothing collected yet is a different fact from nothing collected in the viewed period.
        <EmptyState compact icon={TrendingUp} title={data?.collected ? "No trends in this period." : "Trends show here after the first weekly collection."} />
      ) : (
        <ThemeWeeks themes={shown} staff={isMoburstStaff} onDismiss={setDismissing} />
      )}
      <ConfirmDialog
        open={!!dismissing}
        onOpenChange={(open) => !open && setDismissing(null)}
        title="Dismiss this trend?"
        description={<p>It comes off this list for everyone, and next week's collection leaves out anything like it.</p>}
        confirmLabel="Dismiss"
        destructive={false}
        onConfirm={async () => {
          if (!dismissing) return;
          // The request is sent again quietly if it does not get through (useDismissTrendTheme). If it still did not
          // go, the themes are read again either way and the list shows the true state: the theme stays.
          try {
            await dismiss.mutateAsync(dismissing.id);
            toast.success("Dismissed. Next week's trends will leave it out.");
          } catch (e) {
            console.warn("[trend dismiss] not dismissed yet", e);
          }
          setDismissing(null);
        }}
      />
    </Section>
  );
}
