import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function AppLayout({ children, title }: { children: ReactNode; title?: string }) {
  const { isAuthenticated, isLoading } = useAuth();

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
          {title && <h1 className="t-h1">{title}</h1>}
        </header>
        <main className="relative z-10 flex-1 p-[32px]">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
