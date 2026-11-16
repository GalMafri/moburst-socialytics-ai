/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrandBookUpload } from "@/components/onboarding/BrandBookUpload";
import { BRAND_BOOK_MAX_BYTES, BRAND_BOOK_MAX_TEXT } from "../../supabase/functions/_shared/brand/brandBookLimits";

const f = vi.hoisted(() => ({ uploads: [] as string[], invoke: null as null | (() => Promise<any>) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  storage: { from: () => ({ upload: async (path: string) => { f.uploads.push(path); return { data: {}, error: null }; } }) },
  functions: { invoke: async () => f.invoke!() },
} }));

const file = (name: string, type: string, size: number) => {
  const x = new File(["x"], name, { type });
  Object.defineProperty(x, "size", { value: size });
  return x;
};
const mount = (path = "") => render(<BrandBookUpload clientId="c1" clientName="Bader Law" brandBookUrl="" brandBookFilePath={path} onBrandBookUrlChange={() => {}} onBrandBookFilePathChange={() => {}} onBrandIdentityExtracted={() => {}} />);
const choose = (container: HTMLElement, x: File) => fireEvent.change(container.querySelector("input[type=file]")!, { target: { files: [x] } });

beforeEach(() => { f.uploads = []; f.invoke = async () => ({ data: { brand_identity: null }, error: null }); });
afterEach(cleanup);

describe("the brand book card", () => {
  it("is labeled in sentence case, with the one limit the reader uses", () => {
    mount();
    expect(screen.getByText("Brand book or style guide")).toBeInTheDocument();
    expect(screen.getByText(`Upload a file (PDF, PNG or JPG, up to ${BRAND_BOOK_MAX_TEXT})`)).toBeInTheDocument();
    expect(screen.getByText("Or enter a brand book URL")).toBeInTheDocument();
    expect(screen.queryByText(/Brand Book|Extract Brand/)).toBeNull();
  });

  it("takes a file up to the limit the reader takes and names the limit that stopped a bigger one", async () => {
    const { container } = mount();
    choose(container, file("book.pdf", "application/pdf", 6 * 1024 * 1024));
    await waitFor(() => expect(f.uploads).toHaveLength(1));
    choose(container, file("huge.pdf", "application/pdf", BRAND_BOOK_MAX_BYTES + 1));
    expect(await screen.findByText(`huge.pdf is over ${BRAND_BOOK_MAX_TEXT}, the most that is read.`)).toBeInTheDocument();
    expect(f.uploads).toHaveLength(1);
  });

  it("names the file type that stopped a file", async () => {
    const { container } = mount();
    choose(container, file("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 1000));
    expect(await screen.findByText("notes.docx is not a PDF, PNG or JPG file, the only types that are read.")).toBeInTheDocument();
    expect(f.uploads).toEqual([]);
  });

  it("says why a read stopped when the reader refuses the file", async () => {
    f.invoke = async () => ({ data: { brand_identity: null, not_read: "too_large" }, error: null });
    mount("Bader-Law/c1-1-2.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Read the brand book" }));
    expect(await screen.findByText(`The brand book is over ${BRAND_BOOK_MAX_TEXT}, the most that is read. Choose a smaller file.`)).toBeInTheDocument();
    f.invoke = async () => ({ data: { brand_identity: null, not_read: "type" }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Read the brand book" }));
    expect(await screen.findByText("The brand book is not a PDF, PNG or JPG file, the only types that are read.")).toBeInTheDocument();
  });
});
