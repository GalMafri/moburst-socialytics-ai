import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Sparkles } from "lucide-react";
import { formatDate } from "@/lib/display";

/**
 * The client's design language, as the lifecycle learned it (design_refs):
 * from its own posts, the references a person added and the brand book.
 * Adding or removing either is an input change, so saving the client asks
 * the lifecycle to learn it again (ClientSetup). This card only shows what is
 * stored; it never starts paid work itself.
 */
export function DesignSynthesisCard({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingSynthesis,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  existingSynthesis: any | null;
}) {
  const learnedOn = formatDate(existingSynthesis?.synthesized_at);
  const sources = Number(existingSynthesis?.source_count ?? 0);
  return (
    <Card>
      <CardContent className="pt-5 space-y-3">
        <Label className="t-body font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Brand design language
        </Label>
        {existingSynthesis ? (
          <p className="t-secondary flex items-center gap-2">
            <CheckCircle2 className="h-3 w-3 text-success" />
            {learnedOn ? `Learned on ${learnedOn}` : "Learned"}{sources ? ` from ${sources} source${sources === 1 ? "" : "s"}` : ""}. It is learned again when the client's posts, references or brand book change.
          </p>
        ) : (
          <p className="t-secondary">Learned from the client's own posts, and from any references and brand book here.</p>
        )}
      </CardContent>
    </Card>
  );
}
