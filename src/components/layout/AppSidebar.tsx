import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Home, FileText, Settings, TrendingUp, LogOut } from "lucide-react";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, user } = useAuth();

  const navItems = [
    { icon: Home, label: "Dashboard", href: "/" },
    { icon: FileText, label: "Reports", href: "/reports" },
    { icon: TrendingUp, label: "Analytics", href: "/analytics" },
    ...(isAdmin ? [{ icon: Settings, label: "Settings", href: "/settings" }] : []),
  ];

  return (
    <Sidebar>
      <SidebarHeader className="flex items-center justify-center h-[90px] border-b border-[rgba(255,255,255,0.05)] px-4 py-5">
        <div className="cursor-pointer transition-opacity hover:opacity-80" onClick={() => navigate("/")}>
          <img
            src="/images/logo-dark.png"
            alt="Socialytics by Moburst"
            className="h-10 w-auto max-w-[200px] object-contain"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-[#9ca3af]/70 uppercase text-[11px] tracking-wider">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = item.href === "/" ? location.pathname === "/" : location.pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => navigate(item.href)}
                      className={`h-[52px] rounded-[12px] px-[12px] gap-[16px] text-[16px] font-medium tracking-[-0.5px] transition-all ${
                        isActive
                          ? "nav-active text-white"
                          : "text-[#9ca3af] opacity-80 hover:opacity-100 hover:text-white hover:bg-[rgba(255,255,255,0.03)]"
                      }`}
                    >
                      <item.icon className="h-[24px] w-[24px]" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2 border-t border-[rgba(255,255,255,0.05)]">
        {user && (
          <div className="glass-elevated px-3 py-2 flex items-center gap-3">
            <div className="relative">
              <div className="h-8 w-8 rounded-full bg-[#b9e045] flex items-center justify-center text-black text-sm font-bold">
                {user.name?.charAt(0)?.toUpperCase() || "U"}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#10b981] border-2 border-[#1a1d23]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">{user.name}</div>
              <div className="text-xs text-[#9ca3af] truncate">{user.email}</div>
            </div>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
