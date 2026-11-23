import { useEffect, useRef, useState } from "react";
import { Loading } from "@/components/ui/loading";

/**
 * The interactive API reference, drawn by Scalar's standalone build from the
 * live API's own OpenAPI document, so it is always the code that is deployed.
 * The script is pinned to one version and loaded only when this panel opens;
 * no other page loads it. A key pasted into it to try a call stays in the
 * browser and goes only to the Socialytics API.
 */
export const SCALAR_SRC = "https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.76.4/dist/browser/standalone.js";

type ScalarGlobal = { createApiReference?: (el: HTMLElement | string, config: Record<string, unknown>) => { destroy?: () => void } };

let loading: Promise<void> | null = null;
function loadScalar(): Promise<void> {
  if ((window as unknown as { Scalar?: ScalarGlobal }).Scalar?.createApiReference) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCALAR_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { loading = null; reject(new Error("reference script not loaded")); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function ApiReference({ specUrl }: { specUrl: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let gone = false;
    let app: { destroy?: () => void } | undefined;
    loadScalar().then(() => {
      const scalar = (window as unknown as { Scalar?: ScalarGlobal }).Scalar;
      if (gone || !host.current || !scalar?.createApiReference) return;
      app = scalar.createApiReference(host.current, { url: specUrl, hideClientButton: false, authentication: { preferredSecurityScheme: "ApiKey" }, darkMode: true, hideDarkModeToggle: true });
      setState("ready");
    }).catch((e) => {
      console.warn("[api reference] not loaded", e);
      if (!gone) setState("failed");
    });
    return () => { gone = true; app?.destroy?.(); };
  }, [specUrl]);

  return (
    <div className="space-y-3">
      {state === "loading" && <Loading label="Loading the reference" />}
      {state === "failed" && <p className="t-secondary">The interactive reference is not showing here. Download the OpenAPI JSON from the API page and open it in any OpenAPI viewer.</p>}
      <div ref={host} data-testid="api-reference" className="min-h-[200px] overflow-hidden rounded-xl" />
    </div>
  );
}
