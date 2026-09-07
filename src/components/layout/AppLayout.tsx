import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/ui/page-header";

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function AppLayout({
  children,
  title,
  description,
  meta,
  actions,
  back,
  nav,
  width = "max-w-[1440px]",
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  /**
   * Section rail for long pages (usually a `SectionNav`). It becomes the page's
   * own left column, running from the top beside the header, so the header and
   * every card below it keep one left edge. Pass it on every tab of a page that
   * has it on any tab, or the whole page shifts sideways when the tab changes.
   */
  nav?: ReactNode;
  /**
   * Tailwind max-width class for the whole column (header and content share
   * it). A page with a `nav` widens past this on its own, so the rail comes
   * out of the margin rather than out of the report.
   */
  width?: string;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  // The sidebar is a full rail from 1280px up and an icon rail below that, so a
  // 1024px laptop keeps its content width. The header trigger still toggles it.
  const wide = useMediaQuery("(min-width: 1280px)");
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => (typeof window === "undefined" ? true : window.innerWidth >= 1280));
  useEffect(() => {
    setSidebarOpen(wide);
  }, [wide]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0c10]">
        <div className="animate-pulse text-[#b1b7c1]">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen} style={{ "--sidebar-width-icon": "3.5rem" } as React.CSSProperties}>
      <AppSidebar />
      {/* min-w-0: the inset is the flex item, and a flex item's automatic minimum is
          its content's min-content width — so a wide table anywhere below made the
          whole page wider than a 768px screen and it scrolled sideways. */}
      <SidebarInset className="intercept-bg min-w-0">
        <header className="relative z-10 flex h-[80px] items-center gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(11,12,16,0.5)] backdrop-blur-[60px] px-[32px]">
          <SidebarTrigger className="text-[#b1b7c1] hover:text-white" />
          <Separator orientation="vertical" className="h-5" />
          <div className="min-w-0">
            <p className="text-[20px] font-bold text-white tracking-[-0.5px] leading-[24px] truncate">
              {firstName ? `${greeting()}, ${firstName}` : greeting()}
            </p>
            <p className="t-label">{today}</p>
          </div>
        </header>
        <div className="relative z-10 flex-1 p-[32px]">
          {/* A page with a rail is allowed the rail's width on top of the usual
              column, so the report keeps the width it had. Taking it out of the
              1440 instead cost the content a fifth of its measure and left a
              tall empty column beside it, since the rail is only ever as long
              as its own list. */}
          <div className={`mx-auto w-full ${nav ? "max-w-[1660px]" : width}`}>
            {nav ? (
              <div className="grid gap-5 xl:grid-cols-[180px_minmax(0,1fr)] items-start">
                <div className="min-w-0 xl:sticky xl:top-[112px]">{nav}</div>
                <div className="space-y-6 min-w-0">
                  {title && <PageHeader title={title} description={description} meta={meta} actions={actions} back={back} />}
                  {children}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {title && <PageHeader title={title} description={description} meta={meta} actions={actions} back={back} />}
                {children}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
