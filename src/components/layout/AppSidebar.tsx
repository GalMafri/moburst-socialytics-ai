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
import { Home, Users, FileText, Settings, LogOut, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAdmin, signOut, user } = useAuth();

  const navItems = [
    { icon: Home, label: "Dashboard", href: "/" },
    { icon: FileText, label: "Reports", href: "/reports", adminOnly: false },
    { icon: TrendingUp, label: "Analytics", href: "/analytics", adminOnly: false },
    ...(isAdmin ? [{ icon: Settings, label: "Settings", href: "/settings", adminOnly: true }] : []),
  ];

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-5">
        <div className="cursor-pointer transition-opacity hover:opacity-80" onClick={() => navigate("/")}>
          <img
            src="/images/logo-dark.png"
            alt="Socialytics by Moburst"
            className="h-7 w-auto max-w-[180px] object-contain"
          />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={item.href === "/" ? location.pathname === "/" : location.pathname.startsWith(item.href)}
                    onClick={() => navigate(item.href)}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <div className="text-xs text-sidebar-foreground/60 truncate px-2">
          {user?.email}
        </div>
        <ThemeToggle />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/60 hover:text-sidebar-foreground"
          onClick={signOut}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign Out
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
