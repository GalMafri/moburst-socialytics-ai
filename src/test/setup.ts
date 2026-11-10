import "@testing-library/jest-dom";

// The full suite runs about 330 files on parallel workers, and a screen's
// mocked reads can take more than Testing Library's default 1 second to land
// under that load (two Trends screen tests failed that way on 9 Nov 2026).
// Every findBy and waitFor waits up to 4 seconds; a passing test is no slower.
if (typeof window !== "undefined") {
  const { configure } = await import("@testing-library/react");
  configure({ asyncUtilTimeout: 4000 });
}

if (typeof window !== "undefined") Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
