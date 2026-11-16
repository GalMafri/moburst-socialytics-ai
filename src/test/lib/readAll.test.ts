import { describe, expect, it } from "vitest";
import { readAll } from "@/lib/readAll";

/** A table of n rows that answers at most 1,000 at a time, as the database does. */
const source = (n: number) => {
  const asked: Array<[number, number]> = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    const rows = Array.from({ length: Math.min(to - from + 1, 1000, Math.max(0, n - from)) }, (_, i) => ({ id: from + i }));
    return { data: rows, error: null };
  };
  return { page, asked };
};

describe("readAll", () => {
  it("returns all 2,300 rows of a source that serves 1,000 at a time", async () => {
    const s = source(2300);
    const rows = await readAll(s.page);
    expect(rows).toHaveLength(2300);
    expect(rows[2299]).toEqual({ id: 2299 });
    expect(s.asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("asks once more after an exact multiple, and stops on the empty page", async () => {
    const s = source(2000);
    expect(await readAll(s.page)).toHaveLength(2000);
    expect(s.asked).toHaveLength(3);
  });

  it("returns nothing for an empty source and throws a read error", async () => {
    expect(await readAll(source(0).page)).toEqual([]);
    await expect(readAll(async () => ({ data: null, error: { message: "boom" } }))).rejects.toMatchObject({ message: "boom" });
  });
});
