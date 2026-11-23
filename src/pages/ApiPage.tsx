import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Check, Copy, Download } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TokensCard } from "@/components/api/TokensCard";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const PROJECT = import.meta.env.VITE_SUPABASE_URL as string;
export const API_BASE = `${PROJECT}/functions/v1/api/v1`;
export const OPENAPI_URL = `${API_BASE}/openapi.json`;
export const CONNECTOR_URL = `${PROJECT}/functions/v1/mcp`;

type Tab = "docs" | "tokens";

function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch (e) {
      console.warn(`[api page] copy ${label}`, e);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="t-label w-[130px] shrink-0">{label}</span>
      <code className="input-glass min-w-0 flex-1 break-all rounded-lg px-3 py-1.5 font-mono t-label text-primary">{value}</code>
      <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy ${label}`}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Downloads the live OpenAPI document as a file. */
async function downloadOpenApi() {
  try {
    const res = await fetch(OPENAPI_URL);
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "socialytics-openapi.json";
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn("[api page] openapi download", e);
    window.open(OPENAPI_URL, "_blank", "noopener");
  }
}

function Docs() {
  return (
    <Card>
      <CardContent className="space-y-4">
        <p className="t-secondary">Use the Socialytics API to do from code what you do here in the app. Every call is limited to the companies on the token.</p>
        <CopyChip label="Base URL" value={API_BASE} />
        <p className="t-label">Paste a token from the Tokens tab into Authentication to try calls.</p>
        <CopyChip label="Claude connector" value={CONNECTOR_URL} />
        <p className="t-label">Add it in Claude: Settings &gt; Connectors &gt; Add custom connector.</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild>
            <Link to="/api-access/reference">Open API reference</Link>
          </Button>
          <Button variant="outline" onClick={() => void downloadOpenApi()}>
            <Download aria-hidden />
            Download OpenAPI JSON
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** A small segmented switch, as the moburst.ai tools show at the top right of their API page. */
function Switch({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="API page" className="inline-flex rounded-lg border border-[rgba(255,255,255,0.12)] p-0.5">
      {(["docs", "tokens"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => onChange(t)}
          className={cn("rounded-md px-3 py-1 text-[13px] font-medium transition-colors", tab === t ? "bg-[rgba(255,255,255,0.12)] text-white" : "text-[#b1b7c1] hover:text-white")}
        >
          {t === "docs" ? "Docs" : "Tokens"}
        </button>
      ))}
    </div>
  );
}

/** The API page (account menu > API): Docs and Tokens. Moburst staff only. */
export default function ApiPage() {
  const { isMoburstStaff } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "tokens" ? "tokens" : "docs";
  if (!isMoburstStaff) return <Navigate to="/" replace />;
  return (
    <AppLayout title="API" description="Do from code what you do here in the app" actions={<Switch tab={tab} onChange={(t) => setParams(t === "docs" ? {} : { tab: t }, { replace: true })} />}>
      {tab === "docs" ? <Docs /> : <TokensCard />}
    </AppLayout>
  );
}
