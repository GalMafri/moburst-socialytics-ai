type Pillar = { name: string; description: string };
/** Implement is additive. A matching name never replaces a user-written description. */
export function mergeStrategySuggestions(current: Pillar[], keywords: string[], proposed: Pillar[], proposedKeywords: string[]) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase();
  const names = new Set(current.map(p => normalize(p.name)));
  const terms = new Set(keywords.map(normalize));
  return {
    content_pillars: [...current, ...proposed.filter(p => {
      const key = normalize(p.name);
      if (!key || names.has(key)) return false;
      names.add(key); return true;
    }).map(p => ({name: p.name.trim(), description: p.description}))],
    social_keywords: [...keywords, ...proposedKeywords.filter(k => {
      const key = normalize(k);
      if (!key || terms.has(key)) return false;
      terms.add(key); return true;
    }).map(k => k.trim())],
  };
}
