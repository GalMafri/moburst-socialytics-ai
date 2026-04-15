export function buildBrandPaletteBlock(brand: {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  visual_style?: string;
  tone_of_voice?: string;
  font_family?: string;
  design_elements?: string;
  background_style?: string;
} | null | undefined): string {
  if (!brand) return "";
  const sections: string[] = [];
  const colorLines: string[] = [];
  if (brand.primary_color) colorLines.push(`Primary: ${brand.primary_color}`);
  if (brand.secondary_color) colorLines.push(`Secondary: ${brand.secondary_color}`);
  if (brand.accent_color) colorLines.push(`Accent: ${brand.accent_color}`);
  if (colorLines.length > 0) {
    sections.push(
      `=== DESIGN COLOR PALETTE (use these colors in the design, NEVER display them as text) ===\n` +
      colorLines.join("\n") +
      `\n=== END PALETTE ===\n` +
      `Incorporate these colors naturally into backgrounds, overlays, text, and design elements. White and dark neutrals are OK for contrast.`
    );
  }
  const styleParts: string[] = [];
  if (brand.visual_style) styleParts.push(brand.visual_style);
  if (brand.tone_of_voice) styleParts.push(`Tone: ${brand.tone_of_voice}`);
  if (brand.font_family) styleParts.push(`Typography: ${brand.font_family}`);
  if (styleParts.length > 0) {
    sections.push(`BRAND STYLE: ${styleParts.join(". ")}`);
  }
  return sections.join("\n\n");
}

export function stripHexFromText(text: string): string {
  return text.replace(/#[0-9A-Fa-f]{3,8}/g, "[brand color]");
}
