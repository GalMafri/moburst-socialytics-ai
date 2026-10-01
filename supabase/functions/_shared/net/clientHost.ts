/** The bare host of a website (no scheme, no www, lower case), or null when the value is not a web address. */
export function clientHost(url: string | null | undefined): string | null {
  const s = (url ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}
