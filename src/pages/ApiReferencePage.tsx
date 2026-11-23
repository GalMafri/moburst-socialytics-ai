import { Link, Navigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { ApiReference } from "@/components/api/ApiReference";
import { useAuth } from "@/hooks/useAuth";
import { OPENAPI_URL } from "./ApiPage";

/** The interactive API reference on its own page, drawn from the live OpenAPI document. Moburst staff only. */
export default function ApiReferencePage() {
  const { isMoburstStaff } = useAuth();
  if (!isMoburstStaff) return <Navigate to="/" replace />;
  return (
    <AppLayout
      title="API reference"
      description="Every route from the live API. Paste a token into Authentication to try calls."
      back={<Button asChild variant="ghost" size="sm"><Link to="/api-access"><ArrowLeft aria-hidden />API</Link></Button>}
    >
      <ApiReference specUrl={OPENAPI_URL} />
    </AppLayout>
  );
}
