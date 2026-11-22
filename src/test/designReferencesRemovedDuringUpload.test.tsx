/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P07-05): Client setup > Design references. A person uploads a file and, while it is going up, removes an
// existing reference. send() closes over the designReferences of the render that started it, so when the upload
// finishes it writes [...old references, new] and the removed reference comes back.
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesignReferencesUpload } from "@/components/onboarding/DesignReferencesUpload";

const f = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({
  upload: () => new Promise((resolve) => { f.release = () => resolve({ error: null }); }),
  getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }),
}) } } }));
afterEach(cleanup);

let current: string[] = [];
function Host() {
  const [refs, setRefs] = useState<string[]>(["Acme/c1-old.png"]);
  current = refs;
  return <DesignReferencesUpload clientId="c1" clientName="Acme" designReferences={refs} onDesignReferencesChange={setRefs} />;
}

describe("P07-05 a reference removed while an upload is going up", () => {
  it("stays removed when the upload finishes", async () => {
    const { container } = render(<Host />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "new.png", { type: "image/png", lastModified: 5 });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(f.release).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Remove this reference" }));
    expect(current).toEqual([]);
    await act(async () => { f.release!(); await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(current).toContain("Acme/c1-5-1.png"));
    expect(current).toEqual(["Acme/c1-5-1.png"]);
  });
});
