/**
 * The strategy's header (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
 * design.md, section 1): the 90 days it is for, the one origin line for the
 * whole page, and the data line, which says per platform where its numbers
 * come from. In the PDF it also carries the client's name and logo.
 */

import { originLine, pageDataLine, periodLine, type PagePlatform } from "@/lib/strategyView";

export function StrategyHeader({ client, logo, writtenAt, sources, platforms }: {
  client: string;
  logo: string | null;
  writtenAt: string;
  sources: string[];
  platforms: PagePlatform[];
}) {
  const data = pageDataLine(platforms);
  return (
    <header className="glass px-card py-5 space-y-2" data-testid="strategy-header">
      <div className="hidden print:flex items-center gap-4 pb-2">
        {logo && <img src={logo} alt="" className="h-10 w-auto max-w-[160px] object-contain" />}
        <p className="t-h1">{client} | Social Strategy</p>
      </div>
      <h2 className="t-h2">{periodLine(writtenAt)}</h2>
      <p className="t-label">{originLine(writtenAt, sources)}</p>
      {data && <p className="t-label">{data}</p>}
    </header>
  );
}
