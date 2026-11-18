import { Link, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { RolePreviewBand } from "@/components/preview/RolePreviewBand";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  // The same empty state and button as every other screen, on the app's
  // background, instead of a bare "Oops!" and an underlined link.
  return (
    <div className="flex min-h-screen flex-col bg-[#0b0c10] intercept-bg">
      {/* Shown only to a staff member who is previewing as a client. */}
      <RolePreviewBand />
      <div className="flex flex-1 items-center justify-center p-page">
        <div className="relative z-10 w-full max-w-md glass p-card">
          <EmptyState
            framed={false}
            icon={Compass}
            title="This page does not exist"
            description="The link may be old, or the page may have moved."
            action={
              <Button asChild>
                <Link to="/">Go to the dashboard</Link>
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
};

export default NotFound;
