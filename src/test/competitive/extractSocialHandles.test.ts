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
