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
  width = "max-w-[1440px]",
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  /** Tailwind max-width class for the whole column (header and content share it). */
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
      <SidebarInset className="intercept-bg">
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
        <main className="relative z-10 flex-1 p-[32px]">
          <div className={`mx-auto w-full ${width} space-y-6`}>
            {title && <PageHeader title={title} description={description} meta={meta} actions={actions} back={back} />}
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
