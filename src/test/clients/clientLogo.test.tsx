import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClientLogo } from "@/components/clients/ClientLogo";

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
  });
});
