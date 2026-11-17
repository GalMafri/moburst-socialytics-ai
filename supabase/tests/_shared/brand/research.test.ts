// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { fetchSiteHtml, researchBrand, extractImageUrls, logoFilesOnPage, logoOnPage, parseBrandReply, parseSocialBrandReply, readSocialBrand, siteTextExcerpt, visionImageType } from "../../../functions/_shared/brand/research";

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

describe("logoFilesOnPage", () => {
  it("lists the header's, then the nav's, then the footer's logo images and marked inline SVGs, in page order, without data addresses and without repeats", () => {
    const html = `<html><body>
      <nav class="top"><img class="nav-logo" src="/nav-logo.png"></nav>
      <header>
        <a href="/"><img alt="Home" srcset="/brand-mark.png 1x, /brand-mark@2x.png 2x"></a>
        <img class="Site-LOGO" src="/logo-dark.svg">
        <svg class="logo logo--light" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>
        <img src="/hero.jpg">
        <img id="logo-inline" src="data:image/png;base64,AAAA">
        <img alt="Company logo" src="/logo-dark.svg">
        <nav><img src="/menu-logo.png"></nav>
        <svg aria-label="menu" viewBox="0 0 4 4"><path d="M0 0"/></svg>
        <svg id="empty-logo"></svg>
      </header>
      <main><img class="logo" src="/press/bloomberg.png"></main>
      <footer>
        <svg aria-label="Company Logo" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>
        <img src="/img/LOGO-white.png?v=2&amp;w=300">
        <img class="logo" src="/nav-logo.png">
        <img src="/badge.png">
      </footer>
      <footer><img class="logo" src="/second-footer-logo.png"></footer>
    </body></html>`;
    expect(logoFilesOnPage(html, BASE)).toEqual([
      // The header: its first image whatever it is called, then every image and inline SVG marked as a logo, in page order.
      { url: "https://www.example.com/brand-mark.png" },
      { url: "https://www.example.com/logo-dark.svg" },
      { svg: `<svg class="logo logo--light" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>` },
      { url: "https://www.example.com/menu-logo.png" },
      // The first nav outside the header.
      { url: "https://www.example.com/nav-logo.png" },
      // The first footer.
      { svg: `<svg aria-label="Company Logo" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>` },
      { url: "https://www.example.com/img/LOGO-white.png?v=2&w=300" },
    ]);
  });
  it("gives nothing for a page with no header, nav or footer, and never a logo from the page's body", () => {
    expect(logoFilesOnPage(`<body><img class="logo" src="/press.png"><svg class="logo"><path d="M0 0"/></svg></body>`, BASE)).toEqual([]);
    expect(logoFilesOnPage("", BASE)).toEqual([]);
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

describe("vision images", () => {
  it("tells the format from the file's own bytes and leaves out what the model cannot read", () => {
    const head = (...b: number[]) => new Uint8Array([...b, ...new Array(20).fill(0)]);
    expect(visionImageType(head(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(visionImageType(head(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(visionImageType(head(0x47, 0x49, 0x46, 0x38))).toBe("image/gif");
    expect(visionImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe("image/webp");
    // Bader Law's logo strip, 19 Oct 2026: AVIF served with no content type.
    expect(visionImageType(new Uint8Array([0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]))).toBeNull();
    expect(visionImageType(head(0x42, 0x4d))).toBeNull(); // BMP
    expect(visionImageType(head(0x00, 0x00, 0x01, 0x00))).toBeNull(); // ICO
  });

  it("reads the organization's own schema.org logo first, never a press badge from the page", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":{"@type":"ImageObject","url":"https://example.com/logotype.png"}}</script></head>
      <body><header><a href="/"><img class="site-logo" src="/brand.svg" alt="Example"></a></header>
      <section class="as-seen-in"><img class="logo" src="https://cdn.example.com/bloomberg-1.avif" alt="Bloomberg logo"></section></body></html>`;
    const urls = extractImageUrls(html, "https://example.com/").map((i) => i.url);
    expect(urls[0]).toBe("https://example.com/logotype.png");
    expect(urls).not.toContain("https://cdn.example.com/bloomberg-1.avif");
    expect(urls).toContain("https://example.com/brand.svg");
  });
});

describe("the brand read from social profiles", () => {
  const REPLY = '{"primary_color":"#112233","secondary_color":"#445566","accent_color":"#778899","font_family":"Inter","visual_style":"v","logo_description":"l","tone_of_voice":"t","design_elements":"d","background_style":"b","business_location":{"city":"Austin","region":"TX","country":"US"},"post_languages":["en","ES","english"]}';
  it("reads the identity, where the posts say the business is and the posts' languages", () => {
    expect(parseSocialBrandReply(REPLY)).toEqual({
      identity: { primary_color: "#112233", secondary_color: "#445566", accent_color: "#778899", font_family: "Inter", visual_style: "v", logo_description: "l", tone_of_voice: "t", design_elements: "d", background_style: "b" },
      stated: { city: "Austin", region: "TX", country: "US" }, languages: ["en", "es"],
    });
  });
  it("fills in nothing generic when the reply is not the JSON asked for", () => {
    expect(parseSocialBrandReply("Sorry, I cannot.")).toEqual({ identity: null, stated: null, languages: [] });
    expect(parseSocialBrandReply('{"primary_color":"#112233","business_location":null}').identity).toBeNull();
  });
  it("sends the profile picture and designed posts as images, the posts and bio as text, to gpt-4.1", async () => {
    let body: { model: string; messages: Array<{ role: string; content: unknown }> } | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: REPLY } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const out = await readSocialBrand({ clientName: "Olo", openaiKey: "sk", images: [{ bytes: png, label: "LinkedIn profile picture" }, { bytes: new Uint8Array([1, 2, 3]), label: "unreadable" }], postsText: "P1 Order ahead", bio: "Austin, TX", fetchImpl });
    expect(out.stated).toEqual({ city: "Austin", region: "TX", country: "US" });
    expect(body!.model).toBe("gpt-4.1");
    const parts = body!.messages[1].content as Array<{ type: string; text?: string }>;
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(1);
    expect(parts[0].text).toContain("P1 Order ahead");
    expect(parts[0].text).toContain("Austin, TX");
  });
});

describe("fetchSiteHtml address check", () => {
  const timeout = () => { if (!AbortSignal.timeout) (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal; };

  it("refuses a private address without fetching it", async () => {
    timeout();
    const fetchImpl = vi.fn();
    await expect(fetchSiteHtml("http://169.254.169.254/", { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a public page that redirects to a private address, before requesting it", async () => {
    timeout();
    const fetchImpl = vi.fn(async (u: string) => (u === "https://example.com/"
      ? new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } })
      : new Response("secret")));
    await expect(fetchSiteHtml("https://example.com/", { fetchImpl })).rejects.toThrow();
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual(["https://example.com/"]);
  });

  it("still reads an ordinary public page", async () => {
    timeout();
    const fetchImpl = vi.fn(async () => new Response("<html>ok</html>"));
    expect((await fetchSiteHtml("https://example.com/", { fetchImpl })).html).toBe("<html>ok</html>");
  });
});

describe("researchBrand never reaches a private address through the page it reads", () => {
  const timeout = () => { if (!AbortSignal.timeout) (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal; };
  const PRIVATE = "169.254.169.254";
  const PAGE = `<html><head><link rel="stylesheet" href="http://${PRIVATE}/style.css"><link rel="stylesheet" href="https://example.com/redirect.css"></head>
    <body><header><img class="logo" src="http://${PRIVATE}/logo.svg"><img src="http://${PRIVATE}/hero.png" class="logo"></header></body></html>`;

  it("never requests a stylesheet, SVG or image the page names on a private address, or one that redirects there", async () => {
    timeout();
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (u: string) => {
      requested.push(u);
      if (u === "https://example.com/") return new Response(PAGE, { status: 200 });
      if (u === "https://example.com/redirect.css") return new Response(null, { status: 302, headers: { location: `http://${PRIVATE}/latest` } });
      if (u.startsWith("https://api.openai.com/")) return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
      return new Response("secret", { status: 200 });
    });
    await researchBrand({ websiteUrl: "https://example.com/", openaiKey: "sk", fetchImpl }).catch(() => null);
    expect(requested.filter((u) => u.includes(PRIVATE))).toEqual([]);
    expect(requested).toContain("https://example.com/redirect.css");
  });
});
