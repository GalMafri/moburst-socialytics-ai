import { describe, expect, it } from "vitest";
import { logoOnPage, parseBrandReply, siteTextExcerpt } from "./research";

const BASE = "https://www.example.com";

describe("logoOnPage", () => {
  it("takes the logo the site's schema.org data names first", () => {
    const html = `<script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":{"@type":"ImageObject","url":"https://cdn.example.com/logotype.png"}}]}</script>
      <header><img src="/hero.jpg"></header>`;
    expect(logoOnPage(html, BASE)).toEqual({ url: "https://cdn.example.com/logotype.png" });
  });
  it("then the first image in the header, never a press logo further down the page", () => {
    const html = `<header><a href="/"><img alt="Bader Law" srcset="/_next/logo-baderlaw.png 1x"></a></header>${"<p>text</p>".repeat(4000)}<img class="press-logo" src="/bloomberg.avif">`;
    expect(logoOnPage(html, BASE)).toEqual({ url: "https://www.example.com/_next/logo-baderlaw.png" });
    const press = `<header><nav>Menu</nav></header>${"<p>text</p>".repeat(4000)}<img class="logo" src="/bloomberg.avif">`;
    expect(logoOnPage(press, BASE)).toBeNull();
  });
  it("keeps an inline SVG marked as the logo, and falls back to the touch icon", () => {
    expect(logoOnPage(`<header><svg class="site-logo" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></header>`, BASE)).toMatchObject({ svg: expect.stringContaining("<path") });
    expect(logoOnPage(`<link rel="apple-touch-icon" href="/icon.png"><body></body>`, BASE)).toEqual({ url: "https://www.example.com/icon.png" });
  });
});

describe("parseBrandReply", () => {
  it("splits the brand identity from the headquarters and the language", () => {
    const r = parseBrandReply('{"primary_color":"#112233","secondary_color":"#445566","accent_color":"#778899","font_family":"Inter","visual_style":"v","logo_description":"l","tone_of_voice":"t","design_elements":"d","background_style":"b","headquarters":{"city":"Atlanta","region":"GA","country":"US"},"site_language":"en"}', [], { fonts: null, themeColor: null });
    expect(r.identity).toEqual({ primary_color: "#112233", secondary_color: "#445566", accent_color: "#778899", font_family: "Inter", visual_style: "v", logo_description: "l", tone_of_voice: "t", design_elements: "d", background_style: "b" });
    expect(r.headquarters).toEqual({ city: "Atlanta", region: "GA", country: "US" });
    expect(r.language).toBe("en");
  });
  it("reads no headquarters the site does not state, and builds an identity from the code's colors when the reply is unreadable", () => {
    expect(parseBrandReply('{"primary_color":"#112233","headquarters":null}', [], { fonts: null, themeColor: null }).headquarters).toBeNull();
    const fallback = parseBrandReply("sorry", [{ hex: "#abcdef", source: "css", confidence: "high" }], { fonts: "Lato, serif", themeColor: null });
    expect(fallback.identity).toMatchObject({ primary_color: "#abcdef", font_family: "Lato", logo_description: "Not read from the site" });
  });
});

describe("siteTextExcerpt", () => {
  it("puts the footer first, where a business states its address", () => {
    expect(siteTextExcerpt("<body><h1>We build apps</h1><footer>1250 Broadway, New York, NY 10001</footer></body>")).toBe("Footer: 1250 Broadway, New York, NY 10001\nPage: We build apps");
  });
});
