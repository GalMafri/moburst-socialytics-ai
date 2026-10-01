/**
 * The readable text of a scraped page. Firecrawl's "main content" still
 * carries the navigation, the wishlist counter and every image; a brief
 * drafted from that opens with "[My Wishlist] 0 [Skip to content]". This
 * keeps the sentences and drops the chrome. Pure.
 */
export function cleanSiteText(markdown: string): string {
  const lines = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their text
    .replace(/<[^>]+>/g, " ") // stray html
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s|]+/, "").replace(/\s+/g, " ").trim());
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const l of lines) {
    if (!l) continue;
    const words = l.split(" ").filter((w) => /[a-z]/i.test(w));
    // Navigation, counters and labels are short and carry no sentence; keep lines that read like one.
    if (words.length < 4) continue;
    if (/^(skip to|my wishlist|loading|sign in|log in|cart|menu|search|cookie)/i.test(l)) continue;
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(l);
  }
  return kept.join("\n");
}
