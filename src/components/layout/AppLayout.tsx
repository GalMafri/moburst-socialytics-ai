import { ReactNode, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/use-media-query";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { PageHeader } from "@/components/ui/page-header";
import { Loading } from "@/components/ui/loading";

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
        {/* loading.tsx exists for exactly this and sets role="status"
            aria-live="polite"; this was the one place still rolling its own. */}
        <Loading variant="page" label="Signing you in" />
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
        <header className="relative z-10 flex h-16 md:h-[80px] items-center gap-4 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(11,12,16,0.5)] backdrop-blur-[60px] px-page">
          <SidebarTrigger className="text-[#b1b7c1] hover:text-white" />
          <Separator orientation="vertical" className="h-5" />
          <div className="min-w-0">
            <p className="text-[20px] font-bold text-white tracking-[-0.5px] leading-[24px] truncate">
              {firstName ? `${greeting()}, ${firstName}` : greeting()}
            </p>
            <p className="t-label">{today}</p>
          </div>
        </header>
        {/* One page shell for every screen: the same gutter (p-page), the same
            column (1440px) and the same 24px between blocks. Pages used to
            narrow themselves to 896 or 1024px one by one, so the content edge
            moved from screen to screen; a form that needs less width now
            gets a two-column layout inside the column instead (Section
            layout="split"). */}
        <div className="relative z-10 flex-1 p-page">
          {/* A page with a rail is allowed the rail's width on top of the usual
              column, so the report keeps the width it had. Taking it out of the
              1440 instead cost the content a fifth of its measure and left a
              tall empty column beside it, since the rail is only ever as long
              as its own list. */}
          <div className={`mx-auto w-full ${nav ? "max-w-[1660px]" : "max-w-[1440px]"}`}>
            {nav ? (
              <div className="grid gap-section xl:grid-cols-[180px_minmax(0,1fr)] items-start">
                <div className="min-w-0 xl:sticky xl:top-[112px]">{nav}</div>
                <div className="space-y-section min-w-0">
                  {title && <PageHeader title={title} description={description} meta={meta} actions={actions} back={back} />}
                  {children}
                </div>
              </div>
            ) : (
              <div className="space-y-section">
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
