import { clientOriginLine } from "@/lib/display";

/**
 * Where a client came from, under its name, when the product made it (the
 * weekly Sprout onboarding). Nothing for a client a person made. Shown on
 * staff screens only: the client's setup page and the client list.
 */
export function ClientOrigin({ origin }: { origin: unknown }) {
  const line = clientOriginLine(origin);
  return line ? <p className="t-label">{line}</p> : null;
}
