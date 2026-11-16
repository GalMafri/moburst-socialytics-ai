/**
 * The strategy's header (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
 * design.md, section 1): the 90 days it is for, the one origin line for the
 * whole page, and the data line, which says per platform where its numbers
 * come from. The client's logo shows on screen too; in the PDF the name goes
 * beside it. A new version being written shows as Updating.
 */

import { Badge } from "@/components/ui/badge";
import { originLine, pageDataLine, periodLine, type PagePlatform } from "@/lib/strategyView";

export function StrategyHeader({ client, logo, writtenAt, sources, platforms, updating = false }: {
  client: string;
  logo: string | null;
  writtenAt: string;
  sources: string[];
  platforms: PagePlatform[];
  updating?: boolean;
}) {
  const data = pageDataLine(platforms);
  return (
    <header className="glass px-card py-5 space-y-2" data-testid="strategy-header">
      <div className={`${logo ? "flex" : "hidden print:flex"} items-center gap-4 pb-2`} data-testid="strategy-header-brand">
        {logo && <img src={logo} alt="" className="h-10 w-auto max-w-[160px] object-contain" />}
        <p className="t-h1 hidden print:block">{client} | Social strategy</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="t-h2">{periodLine(writtenAt)}</h2>
        {updating && <Badge variant="outline" data-print="hide">Updating</Badge>}
      </div>
      <p className="t-label">{originLine(writtenAt, sources)}</p>
      {data && <p className="t-label">{data}</p>}
    </header>
  );
}
