import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
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
  actions,
}: {
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const firstName = (user?.name || "").trim().split(/\s+/)[0] || "";
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0c10]">
        <div className="animate-pulse text-[#b1b7c1]">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/auth" replace />;

  return (
    <SidebarProvider>
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
        <main className="relative z-10 flex-1 p-[32px] space-y-6">
          {title && <PageHeader title={title} description={description} actions={actions} />}
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
