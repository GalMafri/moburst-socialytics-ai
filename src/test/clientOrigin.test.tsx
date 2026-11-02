// The line under a client's name that says the Sprout onboarding added it
// (spec: docs/superpowers/specs/2026-11-02-sprout-auto-onboarding-design.md,
// section 7). Staff-only screens show it: the setup page and the client list.
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ClientOrigin } from "@/components/clients/ClientOrigin";

afterEach(cleanup);

it("shows the origin line for a client added from Sprout", () => {
  render(<ClientOrigin origin={{ source: "sprout", brand: "Olo", profile_ids: [7001, 7002], at: "2026-11-09T06:01:00Z" }} />);
  expect(screen.getByText("Added from Sprout Social on Nov 9, 2026")).toBeInTheDocument();
});

it("shows nothing for a client a person made", () => {
  const { container } = render(<ClientOrigin origin={null} />);
  expect(container).toBeEmptyDOMElement();
  render(<ClientOrigin origin={{ source: "other" }} />);
  expect(screen.queryByText(/Added from/)).toBeNull();
});
