import { describe, it, expect } from "vitest";
import { extractSocialHandles } from "../../../supabase/functions/_shared/competitive/extractSocialHandles";

describe("extractSocialHandles", () => {
  it("finds one handle per platform from footer-style links", () => {
    const html = `
      <footer>
        <a href="https://www.instagram.com/acme.fitness/">IG</a>
        <a href="https://www.tiktok.com/@acmefit">TikTok</a>
        <a href="https://www.facebook.com/AcmeFitness">FB</a>
        <a href="https://www.linkedin.com/company/acme-fitness/">LI</a>
        <a href="https://www.youtube.com/@AcmeFit">YT</a>
        <a href="https://x.com/acmefit">X</a>
      </footer>`;
    const out = extractSocialHandles(html);
    const byPlatform = Object.fromEntries(out.map((h) => [h.platform, h.handle]));
    expect(byPlatform).toEqual({
      instagram: "acme.fitness",
      tiktok: "acmefit",
      facebook: "AcmeFitness",
      linkedin: "acme-fitness",
      youtube: "AcmeFit",
      x: "acmefit",
    });
  });

  it("ignores share/embed/help URLs that look like profiles", () => {
    const html = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://twitter.com/intent/tweet?text=hi">tweet</a>
      <a href="https://www.instagram.com/p/Cxyz123/">a post, not a profile</a>
      <a href="https://www.facebook.com/policies/">policies</a>
      <script src="https://www.facebook.com/tr?id=123"></script>`;
    const out = extractSocialHandles(html);
    expect(out.find((h) => h.platform === "facebook")).toBeUndefined();
    expect(out.find((h) => h.platform === "x")?.handle).not.toBe("intent");
    expect(out.find((h) => h.platform === "instagram")).toBeUndefined();
  });

  it("takes the first plausible profile per platform (header beats body mentions)", () => {
    const html = `
      <a href="https://instagram.com/the_brand">us</a>
      <p>as seen on <a href="https://instagram.com/some_influencer">someone else</a></p>`;
    const out = extractSocialHandles(html);
    expect(out.find((h) => h.platform === "instagram")?.handle).toBe("the_brand");
  });

  it("builds canonical profile URLs regardless of query junk in the source", () => {
    const html = `<a href="https://www.tiktok.com/@brand?lang=en&is_copy_url=1">t</a>`;
    const out = extractSocialHandles(html);
    expect(out[0].profile_url).toBe("https://www.tiktok.com/@brand");
  });

  it("returns empty for HTML without social links", () => {
    expect(extractSocialHandles("<html><body>nothing here</body></html>")).toEqual([]);
  });

  it("is not stateful across calls (global regex lastIndex reset)", () => {
    const html = `<a href="https://instagram.com/brand_one">1</a>`;
    const a = extractSocialHandles(html);
    const b = extractSocialHandles(html);
    expect(a).toEqual(b);
    expect(b).toHaveLength(1);
  });
});

describe("the shapes real brand sites emit", () => {
  const wrap = (body: string) => `<html><body>${body}</body></html>`;

  it("reads a URL escaped inside JSON, as React sites emit it", () => {
    const out = extractSocialHandles(wrap(`<script>{"url":"https:\\/\\/www.instagram.com\\/acmewidgets\\/"}</script>`), "Acme Widgets");
    expect(out.find((h) => h.platform === "instagram")?.handle).toBe("acmewidgets");
  });

  it("reads entity-encoded and protocol-relative and uppercase links", () => {
    expect(extractSocialHandles(wrap(`<a href="https:&#x2F;&#x2F;instagram.com&#x2F;acme">ig</a>`)).some((h) => h.handle === "acme")).toBe(true);
    expect(extractSocialHandles(wrap(`<a href="//www.tiktok.com/@acme">tt</a>`)).some((h) => h.handle === "acme")).toBe(true);
    expect(extractSocialHandles(wrap(`<a href="HTTPS://WWW.INSTAGRAM.COM/ACME">ig</a>`)).some((h) => h.handle.toLowerCase() === "acme")).toBe(true);
  });

  it("reads mobile and localised Facebook hosts, and slugs with dashes", () => {
    expect(extractSocialHandles(wrap(`<a href="https://m.facebook.com/Acme-Widgets-100064123456789">fb</a>`)).find((h) => h.platform === "facebook")?.handle)
      .toBe("Acme-Widgets-100064123456789");
    expect(extractSocialHandles(wrap(`<a href="https://de-de.facebook.com/AcmeWidgets">fb</a>`)).find((h) => h.platform === "facebook")?.handle).toBe("AcmeWidgets");
  });

  it("reads a legacy YouTube channel and keeps its URL shape", () => {
    const out = extractSocialHandles(wrap(`<a href="https://www.youtube.com/user/LegacyBrand">yt</a>`));
    const yt = out.find((h) => h.platform === "youtube");
    expect(yt?.handle).toBe("LegacyBrand");
    expect(yt?.profile_url).toBe("https://www.youtube.com/user/LegacyBrand");
  });

  it("reads LinkedIn showcase and school pages, not just company", () => {
    expect(extractSocialHandles(wrap(`<a href="https://www.linkedin.com/showcase/acme-cloud/">li</a>`)).find((h) => h.platform === "linkedin")?.handle).toBe("acme-cloud");
  });

  it("never takes a share widget, a post, or a login page for a profile", () => {
    const noise = wrap(`
      <a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://www.facebook.com/profile.php?id=100064123456789">profile</a>
      <a href="https://www.facebook.com/pages/Acme/123">pages</a>
      <a href="https://www.instagram.com/p/Cxy12345/">post</a>
      <a href="https://www.instagram.com/tv/Cxy12345/">tv</a>
      <a href="https://www.instagram.com/accounts/login/">login</a>
      <a href="https://twitter.com/intent/tweet?text=hi">tweet</a>
      <a href="https://www.youtube.com/watch?v=abc">watch</a>`);
    expect(extractSocialHandles(noise)).toEqual([]);
  });

  it("prefers the brand's own footer link over an embedded feed near the top", () => {
    const page = wrap(`
      <div class="influencer-widget"><a href="https://www.instagram.com/someinfluencer/">feed</a></div>
      ${"<p>copy</p>".repeat(400)}
      <footer class="footer"><a href="https://www.instagram.com/acmewidgets/">Follow us</a></footer>`);
    expect(extractSocialHandles(page, "Acme Widgets").find((h) => h.platform === "instagram")?.handle).toBe("acmewidgets");
  });

  it("keeps a real handle that happens to be a platform's name", () => {
    // A competitor actually called Shopify used to have its handle discarded.
    expect(extractSocialHandles(wrap(`<a href="https://www.instagram.com/shopify/">ig</a>`), "Shopify").find((h) => h.platform === "instagram")?.handle).toBe("shopify");
  });

  it("merges sources without letting a later one overwrite an earlier hit", async () => {
    const { mergeHandles } = await import("../../../supabase/functions/_shared/competitive/extractSocialHandles");
    const merged = mergeHandles(
      [{ platform: "instagram", handle: "first", profile_url: "a", confidence: 0.9 }],
      [
        { platform: "instagram", handle: "second", profile_url: "b", confidence: 0.9 },
        { platform: "x", handle: "third", profile_url: "c", confidence: 0.9 },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((h) => h.platform === "instagram")?.handle).toBe("first");
  });
});

describe("fb.com short links", () => {
  it("reads a facebook handle from fb.com", () => {
    // The host prefix strip is unanchored to a real subdomain, so "fb" was
    // being eaten as a two-letter language prefix and fb.com resolved to
    // "com", matching nothing.
    const out = extractSocialHandles('<footer><a href="https://fb.com/acmecorp">Facebook</a></footer>', "Acme");
    expect(out.find((h) => h.platform === "facebook")?.handle).toBe("acmecorp");
  });

  it("still reads the ordinary host", () => {
    const out = extractSocialHandles('<footer><a href="https://www.facebook.com/acmecorp">Facebook</a></footer>', "Acme");
    expect(out.find((h) => h.platform === "facebook")?.handle).toBe("acmecorp");
  });

  it("still reads a language-prefixed host", () => {
    const out = extractSocialHandles('<footer><a href="https://de-de.facebook.com/acmecorp">Facebook</a></footer>', "Acme");
    expect(out.find((h) => h.platform === "facebook")?.handle).toBe("acmecorp");
  });
});

describe("platform product pages are not profiles", () => {
  it("does not read facebook.com/marketplace as a competitor's page", () => {
    // Seen live: a competitor's stored Facebook handle was "marketplace".
    const out = extractSocialHandles(
      '<footer><a href="https://www.facebook.com/marketplace/">Marketplace</a></footer>',
      "Acme",
    );
    expect(out.find((h) => h.platform === "facebook")).toBeUndefined();
  });

  it("still reads a real page next to a product link", () => {
    const out = extractSocialHandles(
      '<footer><a href="https://www.facebook.com/marketplace/">Marketplace</a><a href="https://www.facebook.com/acmecorp">Us</a></footer>',
      "Acme",
    );
    expect(out.find((h) => h.platform === "facebook")?.handle).toBe("acmecorp");
  });
});

describe("confidence reflects the evidence", () => {
  it("rates a footer link matching the brand far above a loose body link", async () => {
    const { confidenceFor } = await import("../../../supabase/functions/_shared/competitive/extractSocialHandles");
    // A footer hit (3) near "social" (2) whose handle matches the brand (3).
    expect(confidenceFor(8)).toBeGreaterThan(0.9);
    // A link found loose in the body naming nothing like the brand: the case
    // that put an employee's personal TikTok on a competitor at 0.9.
    expect(confidenceFor(0)).toBeLessThan(0.3);
  });

  it("gives a body link with no brand relation a visibly low score", () => {
    const out = extractSocialHandles(
      '<div><p>Filmed by <a href="https://www.tiktok.com/@kat_ayala8">Kat</a></p></div>',
      "Phiture",
    );
    const tiktok = out.find((h) => h.platform === "tiktok");
    expect(tiktok?.handle).toBe("kat_ayala8");
    expect(tiktok!.confidence).toBeLessThan(0.5);
  });
});
