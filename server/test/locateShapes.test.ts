// @vitest-environment node
// server/test/locateShapes.test.ts
//
// The worker and the service agree on every request a logo set can lead to
// (16 Nov 2026). The worker builds a locate request from a settings row with
// jobLogos and locatePlan; the lifecycle builds a post-logos request with
// postSearchPlan. Every shape of set those functions accept is run through
// the service's own request checks here, so a request the service would
// refuse fails this test and never spends a design's try.

import { describe, expect, it } from "vitest";
import { locatePlan, slotPlan, stampPlan } from "../../supabase/functions/_shared/design/logoChoice.ts";
import { jobLogos, postSearchPlan, stampList, type LogoSet, type SetPaths } from "../../supabase/functions/_shared/design/logoTone.ts";
import type { LogoSetResult } from "../../supabase/functions/_shared/picture/contract.ts";
import { pictureSchemas } from "../src/picture/schemas.ts";

const STORAGE = "https://store.test";
const link = (path: string) => `${STORAGE}/storage/v1/object/sign/generated-media/${path}?token=t`;
const { locateBody, postLogosBody, slotBody, slotFileBody } = pictureSchemas(STORAGE);
const placement = { anchor: "center", width: 0.25, top: 0.04 };
const OF = "c1/design-settings/logo-site-aaaa.png";
const OTHER = "c1/design-settings/logo-other.png";
const WHITE = "c1/design-settings/logo-white.png";

const GROUNDS = ["#FFFFFF", "#ffffff", "#0B0E1A", "#0b0e1a", "#FAFAFA", "#10141F", "#7F7F7F", "#2A95FD"];
// The stored file's whole parts: one dark ink, one white ink, a mid-tone that shows on both neutrals, and two inks no one neutral shows whole.
const INKS: Array<Array<[number, number, number]>> = [[[20, 30, 60]], [[255, 255, 255]], [[40, 120, 235]], [[59, 172, 85], [26, 25, 25]]];

describe("every request a logo set can lead to is one the service accepts", () => {
  it("accepts the locate request of every set a job can read", () => {
    let jobs = 0;
    const refused: string[] = [];
    for (const own of ["light", "dark"] as const) for (const both of [true, false]) for (const from of [null, "made", "site", "person"] as const) for (const white of [false, true])
      for (const source of ["lifecycle", "person"]) for (const file of ["stored", "other", "white"] as const) for (const groundFrom of ["client_posts", "settings", "pole"]) for (const ground of GROUNDS) for (const background of GROUNDS) for (const inks of INKS) {
        const set = {
          of: OF, rule: 2, own, both, inks, other: from ? { path: OTHER, from, size: [300, 90] } : null, white: white ? { path: WHITE } : null,
          made: { other: null, white: null }, site: null, ...(from === "person" ? { person: { path: OTHER, of: OF, at: "t" } } : {}),
          posts: { read: 0, found: 0, shown: { stored: 0, other: 0, white: 0 } }, canvas: { file, ground, from: groundFrom }, at: "t",
        };
        const job = jobLogos({ logo_path: OF, background, source, logo_set: set });
        if (!job) continue;
        jobs++;
        const plan = locatePlan({ logo_path: job.logo_path, generate: { background: job.background }, logos: job.logos });
        if (plan.shape !== "set") { refused.push(`${JSON.stringify(set.canvas)}: no set in the plan`); continue; }
        const body = {
          job: "j", step: "locate", design: link("d.png"), placement, scales: [0.5, 1.5],
          templates: plan.templates.map((t) => ({ file: t.file, logo: link(t.path), ground: t.ground, ...(t.fixed ? { fixed: true } : {}), ...(t.names ? { names: t.names } : {}) })),
          compare: plan.compare.map((c) => ({ file: c.file, logo: link(c.path) })),
        };
        // Every template of a set made under the rule of 17 Nov says which other files may be stamped with it.
        if (!plan.templates.every((t) => Array.isArray(t.names))) refused.push(`${JSON.stringify(set.canvas)}: a template with no list of names`);
        const parsed = locateBody.safeParse(body);
        if (!parsed.success) refused.push(`own ${own}, both ${both}, other ${from}, ${source}, ${job.logos.canvas} on ${job.background}: ${parsed.error.issues[0].message}`);
      }
    expect(jobs).toBeGreaterThan(10_000);
    expect([...new Set(refused)]).toEqual([]);
  });

  it("accepts the post-logos request of every set of files", () => {
    const refused: string[] = [];
    for (const own of ["light", "dark"] as const) for (const both of [true, false]) for (const other of [null, OTHER]) for (const white of [null, WHITE]) for (const site of [null, "c1/site.png"]) for (const person of [null, "c1/person.png"]) {
      const facts = { own, both } as LogoSetResult;
      const paths: SetPaths = { other, white, site, person };
      const plan = postSearchPlan(OF, facts, paths);
      const body = {
        job: "c1", step: "design_settings", posts: [link("p.jpg")], placement, scales: [0.5, 1.5],
        searches: plan.searches.map((s) => ({ file: s.file, logo: link(s.path), ground: s.ground, ...(s.fixed ? { fixed: true } : {}) })),
        compare: plan.compare.map((c) => ({ file: c.file, logo: link(c.path) })),
      };
      const parsed = postLogosBody.safeParse(body);
      if (!parsed.success) refused.push(`own ${own}, both ${both}, ${JSON.stringify(paths)}: ${parsed.error.issues[0].message}`);
    }
    expect(refused).toEqual([]);
  });
});

describe("every slot request a job can lead to is one the service accepts", () => {
  it("accepts the slot and the cleaned-slot requests of every set a job can read, with or without made copies, and of a job with one file", () => {
    let jobs = 0;
    const refused: string[] = [];
    const check = (input: Parameters<typeof slotPlan>[0], label: string) => {
      const plan = slotPlan(input);
      const slot = slotBody.safeParse({ job: "j", step: "locate", design: link("d.png"), placement, scales: [0.5, 1.5], templates: plan.templates.map((t) => ({ file: t.file, logo: link(t.path), ground: t.ground })) });
      if (!slot.success) refused.push(`${label}: slot: ${slot.error.issues[0].message}`);
      // The slot of each template that can match, found and not found.
      for (const [index, t] of plan.templates.entries()) for (const from of ["drawn", "canvas"] as const) {
        const state = { logo_rect: { x: 10, y: 10, width: 100, height: 30 }, logo_frame: [2176, 2720] as [number, number], logo_slot: from === "drawn" ? { from, of: t.file, template: { file: t.file, ground: t.ground } } : { from, of: plan.templates[0].file } };
        const stamp = stampPlan(input, state);
        const body = { job: "j", step: "marks", picture: link("n.png"), rect: stamp.rect, frame: stamp.frame, of: stamp.of, files: stamp.files.map((f) => ({ file: f.file, logo: link(f.path), ...(f.last ? { last: true } : {}) })), ...(stamp.drawn ? { drawn: stamp.drawn } : {}) };
        const parsed = slotFileBody.safeParse(body);
        if (!parsed.success) refused.push(`${label}, template ${index}, ${from}: slot-file: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`);
      }
    };
    for (const own of ["light", "dark"] as const) for (const both of [true, false]) for (const from of [null, "made", "site", "person"] as const) for (const white of [false, true])
      for (const made of [{ other: null, white: null }, { other: OTHER, white: WHITE }, { other: null, white: WHITE }]) for (const found of [0, 3])
        for (const source of ["lifecycle", "person"]) for (const file of ["stored", "other", "white"] as const) for (const ground of ["#FFFFFF", "#0B0E1A", "#2A95FD"]) for (const background of ["#FFFFFF", "#0B0E1A", "#7F7F7F"]) for (const inks of INKS) {
          const set = {
            of: OF, rule: 2, own, both, inks, other: from ? { path: from === "made" ? OTHER : "c1/design-settings/logo-brand.png", from, size: [300, 90] } : null, white: white ? { path: WHITE } : null,
            made, site: null, ...(from === "person" ? { person: { path: "c1/design-settings/logo-brand.png", of: OF, at: "t" } } : {}),
            posts: { read: 12, found, shown: { stored: found, other: 0, white: 0 } }, canvas: { file, ground, from: "client_posts" }, at: "t",
          };
          const job = jobLogos({ logo_path: OF, background, source, logo_set: set });
          if (!job) continue;
          jobs++;
          check({ logo_path: job.logo_path, generate: { background: job.background }, logos: job.logos, stamp: stampList(OF, set as unknown as Partial<LogoSet>) }, `own ${own}, both ${both}, other ${from}, ${job.logos.canvas} on ${job.background}`);
          // The same job as it was started before this change: no stamp list.
          check({ logo_path: job.logo_path, generate: { background: job.background }, logos: job.logos }, "a job from before");
        }
    check({ logo_path: OF, generate: { background: "#FFCFDA" } }, "one file");
    expect(jobs).toBeGreaterThan(1_000);
    expect([...new Set(refused)]).toEqual([]);
  });
});
