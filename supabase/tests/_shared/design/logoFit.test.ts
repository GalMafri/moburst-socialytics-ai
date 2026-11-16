import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import type { Settings } from "../../../functions/_shared/canva/jobs";
import { type FitLogo, settleLogo } from "../../../functions/_shared/design/logoFit";
import { placementFor } from "../../../functions/_shared/lifecycle/designSettings";

// A stored logo is its ink alone before a design is built on it, with nobody
// asked to do anything; a person's settings and their date stay as they are.

const NOW = new Date("2026-11-12T10:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  client_id: "c1", logo_path: "c1/logo.png", placement: { anchor: "center", width: 0.3, top: 0.04 }, background: "#0B0E1A", reference_paths: ["c1/a.jpg"],
  source: "lifecycle", derived: { placement_from: "client_posts", logo_read: { shown: true, at: "bottom-center", width: 0.3 } }, updated_at: "2026-10-01T09:00:00Z", ...over,
});
const FITTED = { path: "c1/design-settings/logo-site-abc.png", width: 320, height: 128 };
const setup = (over: Record<string, unknown> = {}, fit: FitLogo = async () => FITTED) => {
  const db = fakeDb({ design_brand_settings: [row(over)] });
  const load = vi.fn(async () => fit);
  return { db, load, settings: db.tables.design_brand_settings[0] as unknown as Settings };
};

describe("settleLogo", () => {
  it("names the trimmed file, works the placement out again for its shape, and leaves updated_at alone", async () => {
    const { db, load, settings } = setup();
    const used = await settleLogo(db, { ...settings }, load, () => NOW);
    const stored = db.tables.design_brand_settings[0];
    expect(used.logo_path).toBe(FITTED.path);
    expect(stored.logo_path).toBe(FITTED.path);
    expect(stored.placement).toEqual(placementFor({ shown: true, at: "bottom-center", width: 0.3 }, 320 / 128).placement);
    expect(used.placement).toEqual(stored.placement);
    expect(stored.derived).toMatchObject({ placement_from: "client_posts", logo_checked: FITTED.path, logo_refit: { from: "c1/logo.png", size: [320, 128], at: NOW.toISOString() } });
    expect(stored.updated_at).toBe("2026-10-01T09:00:00Z");
    expect(stored.source).toBe("lifecycle");
  });

  it("keeps the placement when the settings were not derived by the lifecycle", async () => {
    const { db, load, settings } = setup({ derived: {} });
    await settleLogo(db, { ...settings }, load, () => NOW);
    expect(db.tables.design_brand_settings[0].logo_path).toBe(FITTED.path);
    expect(db.tables.design_brand_settings[0].placement).toEqual({ anchor: "center", width: 0.3, top: 0.04 });
  });

  it("marks a file that is already its ink alone, and does not look at it again", async () => {
    const { db, load, settings } = setup({}, async () => null);
    const used = await settleLogo(db, { ...settings }, load, () => NOW);
    expect(used.logo_path).toBe("c1/logo.png");
    expect(db.tables.design_brand_settings[0].derived).toMatchObject({ logo_checked: "c1/logo.png" });
    expect(db.tables.design_brand_settings[0].updated_at).toBe("2026-10-01T09:00:00Z");
    await settleLogo(db, used, load, () => NOW);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("leaves a person's settings exactly as they are and reads nothing", async () => {
    const { db, load, settings } = setup({ source: "person" });
    const before = JSON.stringify(db.tables.design_brand_settings[0]);
    expect(await settleLogo(db, { ...settings }, load, () => NOW)).toEqual(settings);
    expect(load).not.toHaveBeenCalled();
    expect(JSON.stringify(db.tables.design_brand_settings[0])).toBe(before);
  });

  it("uses the logo as stored when the file cannot be read right now, marks nothing, and looks again next time", async () => {
    const { db, load, settings } = setup({}, async () => { throw new Error("storage busy"); });
    const before = JSON.stringify(db.tables.design_brand_settings[0]);
    const used = await settleLogo(db, { ...settings }, load, () => NOW);
    expect(used.logo_path).toBe("c1/logo.png");
    expect(JSON.stringify(db.tables.design_brand_settings[0])).toBe(before);
  });

  it("does not overwrite a logo a person set while the file was being read", async () => {
    const { db, load, settings } = setup({}, async () => { db.tables.design_brand_settings[0].logo_path = "c1/new-upload.png"; return FITTED; });
    await settleLogo(db, { ...settings }, load, () => NOW);
    expect(db.tables.design_brand_settings[0].logo_path).toBe("c1/new-upload.png");
  });

  it.each([["a trimmed file", async () => FITTED], ["an already trimmed file", async () => null]])("leaves a row that became the person's own between the read and the write unchanged (%s)", async (_n, fit) => {
    const { db, load, settings } = setup({}, async () => { db.tables.design_brand_settings[0].source = "person"; return fit(); });
    const before = JSON.stringify({ ...db.tables.design_brand_settings[0], source: "person" });
    await settleLogo(db, { ...settings }, load, () => NOW);
    expect(JSON.stringify(db.tables.design_brand_settings[0])).toBe(before);
  });
});
