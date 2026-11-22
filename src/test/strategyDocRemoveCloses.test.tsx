/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P07-04): Client setup > Strategy, "Remove the strategy document?" > Remove. ConfirmDialog keeps itself open
// while onConfirm runs and leaves closing to the caller ("the caller closes it"); StrategyDocUpload's remove()
// only clears the path and never closes it, so the dialog stays up after Remove, as if the click did nothing.
import React, { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrategyDocUpload } from "@/components/onboarding/StrategyDocUpload";

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ upload: async () => ({ error: null }) }) } } }));
afterEach(cleanup);

function Host() {
  const [path, setPath] = useState("Acme/strategy-c1-1-2.pdf");
  return <StrategyDocUpload clientId="c1" clientName="Acme" filePath={path} onFilePathChange={setPath} />;
}

describe("P07-04 Remove the strategy document", () => {
  it("closes the confirmation once Remove is chosen", async () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: "Remove the strategy document" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    // The document is detached (the upload control is back)...
    await waitFor(() => expect(screen.getByText("Upload a strategy")).toBeInTheDocument());
    // ...and the confirmation should be gone.
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull(), { timeout: 2000 });
    expect(dialog).toBeTruthy();
  });
});
