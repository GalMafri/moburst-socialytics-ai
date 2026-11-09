// @vitest-environment node
// 20261111100100_trend_theme_dashes.sql, applied twice to PGlite: the themes
// written before the theme writer's dash rule are cleaned once, by the same
// rule the writer applies to every new theme (trends/text.ts withoutDashes),
// so each stored field ends as withoutDashes would write it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withoutDashes } from "../../../functions/_shared/trends/text";

const migrations = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "migrations");
const migration = readFileSync(join(migrations, "20261111100100_trend_theme_dashes.sql"), "utf8");

const EN = "–";
const EM = "—";
/** What themes carry: number ranges, a dash before a capital, leading and trailing dashes, doubled punctuation, and plain text. */
const SAMPLES = [
  `Show 3${EN}5 results ${EM} then the plan`,
  `From 2019 ${EN} 2024, budgets moved`,
  `AI ${EM} in public`,
  `It works${EN} Buyers notice`,
  `${EM} The angle opens with a dash`,
  `${EM}lower case after a leading dash`,
  `It ends on a dash ${EM}`,
  `Done. ${EM} Next week the plan changes`,
  `Wait, ${EN} then post`,
  `Two dashes${EM}${EM}one break`,
  `A theme${EM}with no spaces`,
  `Spaces  before ${EM}  and after`,
  "Plain text, nothing to change: data-driven, 3-5 posts.",
  "",
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create table public.trend_themes (id serial primary key, title text not null, happening text not null, why_it_matters text not null, angle text not null);`);
  // Each sample once in every field, the fields rotated so each row holds four different texts.
  for (let i = 0; i < SAMPLES.length; i++) {
    const at = (k: number) => SAMPLES[(i + k) % SAMPLES.length];
    await db.query("insert into public.trend_themes (title, happening, why_it_matters, angle) values ($1, $2, $3, $4)", [at(0), at(1), at(2), at(3)]);
  }
  await db.exec(migration);
  await db.exec(migration);
});
afterAll(async () => { await db.close(); });

describe("20261111100100_trend_theme_dashes.sql", () => {
  it("writes every theme field as withoutDashes would, applied twice", async () => {
    const rows = (await db.query<{ id: number; title: string; happening: string; why_it_matters: string; angle: string }>("select * from public.trend_themes order by id")).rows;
    expect(rows).toHaveLength(SAMPLES.length);
    rows.forEach((r, i) => {
      const at = (k: number) => withoutDashes(SAMPLES[(i + k) % SAMPLES.length]);
      expect([r.title, r.happening, r.why_it_matters, r.angle]).toEqual([at(0), at(1), at(2), at(3)]);
    });
    expect(JSON.stringify(rows)).not.toMatch(/[–—]/);
  });

  it("is the rule the writer uses, sample by sample", () => {
    expect(SAMPLES.map(withoutDashes)).toEqual([
      "Show 3 to 5 results, then the plan",
      "From 2019 to 2024, budgets moved",
      "AI, in public",
      "It works. Buyers notice",
      "The angle opens with a dash",
      "lower case after a leading dash",
      "It ends on a dash",
      "Done. Next week the plan changes",
      "Wait, then post",
      "Two dashes, one break",
      "A theme, with no spaces",
      "Spaces before, and after",
      "Plain text, nothing to change: data-driven, 3-5 posts.",
      "",
    ]);
  });

  it("leaves a theme with no dash as it is", async () => {
    await db.query("insert into public.trend_themes (title, happening, why_it_matters, angle) values ($1, $1, $1, $1)", ["Keep  this  spacing"]);
    await db.exec(migration);
    const r = (await db.query<{ title: string }>("select title from public.trend_themes where title like 'Keep%'")).rows[0];
    expect(r.title).toBe("Keep  this  spacing");
  });
});
