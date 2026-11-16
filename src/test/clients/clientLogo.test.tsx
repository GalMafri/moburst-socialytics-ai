import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ClientLogo } from "@/components/clients/ClientLogo";
import { ClientPicker } from "@/components/clients/ClientPicker";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: (bucket: string) => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.test/${bucket}/${path}` } }) }) } },
}));

describe("a client's logo", () => {
  it("shows the whole logo, so a wide wordmark is never cut off", () => {
    const { container } = render(<ClientLogo client={{ name: "Moburst", logo_url: "https://example.com/logo.png" }} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.com/logo.png");
    expect(img.className).toContain("object-contain");
    expect(img.className).not.toContain("object-cover");
    // A fixed height with a free width: a wordmark keeps its shape.
    expect(img.className).toContain("w-auto");
  });

  it("shows the client's initials when it has no logo", () => {
    const { container, getByText } = render(<ClientLogo client={{ name: "Pay The Pyper", logo_url: null }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(getByText("PA")).toBeTruthy();
  });

  it("is the only way screens draw a client's logo, and none of them crops it", () => {
    const files: string[] = [];
    const walk = (dir: string) => readdirSync(dir).forEach((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    });
    walk(join(__dirname, "..", "..", "components"));
    walk(join(__dirname, "..", "..", "pages"));
    const cropped = files.filter((f) => /<img[^>]*logo_url[^>]*object-cover|<img[^>]*object-cover[^>]*logo_url/.test(readFileSync(f, "utf8")));
    expect(cropped).toEqual([]);
    // And none draws one by hand: every <img> that reads a client's logo_url is this component.
    const byHand = files.filter((f) => !f.endsWith("ClientLogo.tsx") && /<img[^>]*logo_url/.test(readFileSync(f, "utf8")));
    expect(byHand).toEqual([]);
  });

  it("draws a logo on the surface its client chose, so a dark logo is never lost on the dark card", () => {
    const client = { name: "Twos", logo_url: "https://example.com/black.svg", design_brand_settings: { logo_path: "c/brand/logo.png", background: "#FFFFFF" } };
    const { container } = render(<ClientLogo client={client} />);
    const img = container.querySelector("img")!;
    // The stored copy is the one the designs use.
    expect(img.getAttribute("src")).toBe("https://files.test/generated-media/c/brand/logo.png");
    const tile = img.parentElement as HTMLElement;
    expect(tile.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(img.className).toContain("object-contain");
    // A wide wordmark on its surface is capped like one without, and a caller's own cap still wins.
    expect(tile.className).toContain("max-w-[8rem]");
    const { container: capped } = render(<ClientLogo client={client} className="max-w-14" />);
    expect((capped.querySelector("img")!.parentElement as HTMLElement).className).toContain("max-w-14");
    expect((capped.querySelector("img")!.parentElement as HTMLElement).className).not.toContain("max-w-[8rem]");
  });

  it("falls back to the client's logo_url on that surface when no copy is stored, and reads a one-item list of settings", () => {
    const { container } = render(<ClientLogo client={{ name: "BetterBee", logo_url: "https://example.com/b.svg", design_brand_settings: [{ logo_path: "", background: "#FFF9EA" }] }} />);
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://example.com/b.svg");
    expect((img.parentElement as HTMLElement).style.backgroundColor).toBe("rgb(255, 249, 234)");
  });

  it("draws a logo with no chosen surface as it is, with no tile", () => {
    const { container } = render(<ClientLogo client={{ name: "Moburst", logo_url: "https://example.com/m.png", design_brand_settings: null }} />);
    expect((container.querySelector("img")!.parentElement as HTMLElement).style.backgroundColor).toBe("");
  });

  it("takes a size, and the picker draws the same logo in a fixed-width slot at the same height", () => {
    const { container } = render(<ClientLogo client={{ name: "Moburst", logo_url: "https://example.com/m.png" }} size="compact" />);
    expect(container.querySelector("img")!.className).toContain("h-8");
    const clients = [{ id: "a", name: "Twos", logo_url: "https://example.com/black.svg", design_brand_settings: { logo_path: "a/logo.png", background: "#FFFFFF" } }];
    const picker = render(<ClientPicker clients={clients} selectedId="a" onSelect={() => {}} search="" onSearch={() => {}} />);
    const img = picker.container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://files.test/generated-media/a/logo.png");
    expect((img.parentElement as HTMLElement).style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(img.className).toContain("h-");
    expect(img.className).toContain("object-contain");
  });
});
