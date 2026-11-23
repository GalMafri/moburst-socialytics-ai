// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestMeter } from "../../paid/testMeter";
import { fetchSiteHtml, researchBrand, extractImageUrls, logoFilesOnPage, logoOnPage, ownMarksOnPage, ownPaint, standaloneSvg, parseBrandReply, parseSocialBrandReply, readSocialBrand, siteTextExcerpt, visionImageType } from "../../../functions/_shared/brand/research";

const BASE = "https://www.example.com";
const cost = { tool: "socialytics" as const, clientId: "c1", feature: "brand.research", actor: "user" as const };
afterEach(() => { vi.unstubAllGlobals(); useTestMeter(); });

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
  it("lists a mark inside a link to the home page, whatever it is called, the same inline SVG once, and the schema.org logo last", () => {
    const mark = (w: number, h: number) => `<svg width="${w}" height="${h}" viewBox="0 0 579 194" fill="white" aria-hidden="true"><g><path d="M1 1h5v5z"/></g></svg>`;
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":"https://cdn.example.com/icon.svg"}</script></head><body>
      <header>
        <button aria-label="Open menu"><svg viewBox="0 0 24 24"><path d="M4 7h16"/></svg></button>
        <a href="/" aria-label="Brand">${mark(76, 25)}</a>
        <a href="/pricing"><svg viewBox="0 0 9 9"><path d="M0 0"/></svg></a>
        <a href="#"><svg viewBox="0 0 7 7"><path d="M0 0"/></svg></a>
      </header>
      <main><a href="/"><img src="/hero-mark.png"></a></main>
      <footer>
        <a href="https://example.com/">${mark(92, 31)}</a>
        <a href="https://www.example.com"><img src="/footer-mark.png"></a>
        <a href="/?lang=fr"><img src="/flags/fr.png"></a>
        <a href="https://partner.test/"><img src="/partner.png"></a>
      </footer>
    </body></html>`;
    expect(logoFilesOnPage(html, BASE)).toEqual([
      { svg: mark(76, 25) },
      { url: "https://www.example.com/footer-mark.png" },
      { url: "https://cdn.example.com/icon.svg" },
    ]);
  });
  it("reads a mark a site draws as a data address in a link to the home page as the SVG it is", () => {
    // Page builders write the mark into a style as a data address with the quotes escaped; as listed it would never draw.
    const html = `<body><nav><a href="./"><div style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 10 10%22><path d=%22M0 0h10v10z%22/></svg>')"></div></a></nav></body>`;
    expect(logoFilesOnPage(html, BASE)).toEqual([{ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>` }]);
    // An ordinary inline SVG is not touched.
    const plain = `<nav><a href="/"><svg viewBox="0 0 5 5"><path d="M0 0h5v5z" fill="#1d2%2f"/></svg></a></nav>`;
    expect(logoFilesOnPage(plain, BASE)).toEqual([{ svg: `<svg viewBox="0 0 5 5"><path d="M0 0h5v5z" fill="#1d2%2f"/></svg>` }]);
  });
  it("gives nothing for a page with no header, nav or footer, and never a logo from the page's body", () => {
    expect(logoFilesOnPage(`<body><img class="logo" src="/press.png"><svg class="logo"><path d="M0 0"/></svg></body>`, BASE)).toEqual([]);
    expect(logoFilesOnPage("", BASE)).toEqual([]);
  });
});

describe("ownMarksOnPage", () => {
  it("keeps only the marks the page ties to its own brand: the header's, a link to the home page's, and the schema.org logo", () => {
    const mark = `<svg viewBox="0 0 579 194" fill="white"><g><path d="M1 1h5v5z"/></g></svg>`;
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":"https://cdn.example.com/icon.svg"}</script></head><body>
      <header><a href="/">${mark}</a><img class="logo" src="/logo-dark.svg"></header>
      <nav><a href="/"><img src="/nav-mark.png"></a><img class="partner-logo" src="/partner-logo.png"></nav>
      <footer>
        <img class="logo" src="/visa-logo.png">
        <a href="https://bbb.test/"><img src="/bbb-logo.png"></a>
        <img alt="App Store logo" src="/app-store-logo.svg">
        <a href="https://www.example.com/"><img src="/footer-mark.png"></a>
      </footer>
    </body></html>`;
    // The wide list, for a brand's second file, still holds the footer's and the nav's named logos.
    expect(logoFilesOnPage(html, BASE).map((f) => ("url" in f ? f.url.replace("https://www.example.com", "") : "svg"))).toEqual([
      "svg", "/logo-dark.svg", "/nav-mark.png", "/partner-logo.png", "/visa-logo.png", "/bbb-logo.png", "/app-store-logo.svg", "/footer-mark.png", "https://cdn.example.com/icon.svg",
    ]);
    // The candidates for the client's logo itself: no partner, payment or store badge.
    expect(ownMarksOnPage(html, BASE)).toEqual([
      { svg: mark },
      { url: "https://www.example.com/logo-dark.svg" },
      { url: "https://www.example.com/nav-mark.png" },
      { url: "https://www.example.com/footer-mark.png" },
      { url: "https://cdn.example.com/icon.svg" },
    ]);
  });
  it("counts a file the footer names as the brand's own once the schema.org record names it too", () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Organization","logo":"/img/brand-logo.png"}</script></head><body><footer><img class="logo" src="/img/brand-logo.png"></footer></body></html>`;
    expect(ownMarksOnPage(html, BASE)).toEqual([{ url: "https://www.example.com/img/brand-logo.png" }]);
  });
  it("leaves out an inline SVG that takes its color from the page, and keeps one a data address holds", () => {
    // Drawn as a file of its own this mark would come out black, whatever color the page gives it.
    const page = `<header><a href="/"><svg viewBox="0 0 10 10"><path fill="currentColor" d="M0 0h10v10z"/></svg></a></header>`;
    expect(logoFilesOnPage(page, BASE)).toHaveLength(1);
    expect(ownMarksOnPage(page, BASE)).toEqual([]);
    const bare = `<header><a href="/"><svg class="logo" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg></a></header>`;
    expect(ownMarksOnPage(bare, BASE)).toEqual([]);
    // A data address is a file of its own: no style of the page reaches into it, so what it draws is what the page shows.
    const data = `<body><nav><a href="./"><div style="background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 10 10%22><path d=%22M0 0h10v10z%22/></svg>')"></div></a></nav></body>`;
    expect(ownMarksOnPage(data, BASE)).toEqual([{ svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>` }]);
  });
});

describe("ownPaint", () => {
  it("holds when every shape is painted by the SVG's own text", () => {
    expect(ownPaint(`<svg viewBox="0 0 9 9" fill="white"><g><path d="M0 0"/></g></svg>`)).toBe(true);
    expect(ownPaint(`<svg viewBox="0 0 9 9" fill="none"><g fill="#0071FA"><path d="M0 0"/><rect width="2" height="2"></rect></g><circle r="2" stroke="#000"/></svg>`)).toBe(true);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path style="fill:#fff" d="M0 0"/><text fill="#111">Brand</text></svg>`)).toBe(true);
    // Its own style sheet colors the classes it names.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><defs><style>.a{fill:#fff}</style></defs><path class="a" d="M0 0"/></svg>`)).toBe(true);
    // Each class a shape has is looked up by name: a list of selectors, one class of several on the shape, a class on the group around it.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a, .b { stroke: #111 } .c{opacity:.5}</style><path class="c b" d="M0 0"/><g class="a"><rect width="2" height="2"/></g></svg>`)).toBe(true);
    // As a drawing program writes it: the style in a CDATA section, with a comment.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style type="text/css"><![CDATA[ /* brand */ .st0{fill:#0071FA;} ]]></style><path class="st0" d="M0 0"/></svg>`)).toBe(true);
    // A shape that only cuts another (a clip path) is not painted.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><clipPath id="c"><rect width="9" height="9"/></clipPath><path fill="#fff" clip-path="url(#c)" d="M0 0"/></svg>`)).toBe(true);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><symbol id="m"><path fill="#fff" d="M0 0"/></symbol><use href="#m"/></svg>`)).toBe(true);
  });
  it("fails when the page would color it: currentColor, a page variable, a shape with no paint, a class no style of its own names, a drawing kept elsewhere", () => {
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path fill="currentColor" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9" style="color:CurrentColor"><path fill="#fff" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path fill="var(--brand)" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><g fill="#fff"><path d="M0 0"/></g><path fill-rule="evenodd" d="M1 1"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path class="logo-fill" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a{opacity:.5}</style><path class="a" d="M0 0"/></svg>`)).toBe(false);
    // Its own style paints class a. The shape has class b, which only a style of the page could color.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a{fill:#f00}</style><path class="b" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a{fill:#f00}.b{opacity:.5}</style><path class="a" d="M0 0"/><path class="b" d="M1 1"/></svg>`)).toBe(false);
    // A rule that paints a class only inside another element, or only in a state, does not paint a shape that merely has the class.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.dark .a{fill:#fff}</style><path class="a" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a:hover{fill:#fff}</style><path class="a" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>@media (min-width: 900px) { .a { fill: #fff } }</style><path class="a" d="M0 0"/></svg>`)).toBe(false);
    // A rule that sets something that only sounds like a paint (fill-rule, stroke-width) paints nothing.
    expect(ownPaint(`<svg viewBox="0 0 9 9"><style>.a{fill-rule:evenodd;stroke-width:2}</style><path class="a" d="M0 0"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><use href="#site-logo"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><use xlink:href="/sprite.svg#logo"/></svg>`)).toBe(false);
    expect(ownPaint(`<svg viewBox="0 0 9 9"><path fill="inherit" d="M0 0"/></svg>`)).toBe(false);
  });
});

describe("standaloneSvg", () => {
  it("adds the namespace an inline SVG leaves out, and nothing else", () => {
    expect(standaloneSvg(`<svg width="76" viewBox="0 0 5 5" fill="white"><path d="M0 0h5v5z"/></svg>`)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" width="76" viewBox="0 0 5 5" fill="white"><path d="M0 0h5v5z"/></svg>`);
    expect(standaloneSvg(`<svg viewBox="0 0 5 5"><use xlink:href="#a"/></svg>`)).toBe(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 5 5"><use xlink:href="#a"/></svg>`);
  });
  it("leaves an SVG that is already a file of its own exactly as it is", () => {
    const whole = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><path d="M0 0h5v5z"/></svg>`;
    expect(standaloneSvg(whole)).toBe(whole);
    expect(standaloneSvg("not an svg")).toBe("not an svg");
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
    let url = "";
    useTestMeter(async (u: string, init?: RequestInit) => {
      url = u;
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: REPLY } }] }), { status: 200 });
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const out = await readSocialBrand({ clientName: "Olo", cost, images: [{ bytes: png, label: "LinkedIn profile picture" }, { bytes: new Uint8Array([1, 2, 3]), label: "unreadable" }], postsText: "P1 Order ahead", bio: "Austin, TX" });
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
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
    // The model call goes through the paying desk (its test meter sends it to the same fake), with the key set.
    vi.stubGlobal("Deno", { env: { get: (k: string) => (k === "OPENAI_API_KEY" ? "sk" : undefined) } });
    useTestMeter((u, init) => fetchImpl(u, init));
    await researchBrand({ websiteUrl: "https://example.com/", cost, fetchImpl }).catch(() => null);
    expect(requested).toContain("https://api.openai.com/v1/chat/completions");
    expect(requested.filter((u) => u.includes(PRIVATE))).toEqual([]);
    expect(requested).toContain("https://example.com/redirect.css");
  });
});
