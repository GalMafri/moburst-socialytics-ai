import { Link, useLocation } from "react-router-dom";
import { activeNavigationSection } from "@/lib/navigationSection";
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
import { Home, FileText, Settings, TrendingUp, LogOut, ExternalLink, Gauge, Crosshair, CalendarDays, Compass, KeyRound } from "lucide-react";
import { portalUrl } from "@/utils/gosAuth";
import { PreviewAsClient } from "@/components/preview/PreviewAsClient";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

// One nav row, written once (the Intercept nav spec: 52px rows, 24px icons).
const NAV_ITEM = "h-[52px] rounded-[12px] px-[12px] gap-[16px] text-[15px] font-medium tracking-[-0.5px] transition-all";
const NAV_IDLE = "text-[#b1b7c1] opacity-80 hover:opacity-100 hover:text-white hover:bg-[rgba(255,255,255,0.03)]";

export function AppSidebar() {
  const location = useLocation();
  const { isAdmin, isMoburstStaff, isClient, user, isGosSession } = useAuth();

  const navItems = [
    { icon: Home, label: "Dashboard", href: "/" },
    // Cross-client "All Reports" view is Moburst-staff only. Clients use the
    // per-client report history linked from ClientDashboard.
    ...(isMoburstStaff ? [{ icon: FileText, label: "Reports", href: "/reports" }] : []),
    // Each client's content strategy: the team's working draft, staff only.
    ...(isMoburstStaff ? [{ icon: Compass, label: "Strategy", href: "/strategy" }] : []),
    { icon: CalendarDays, label: "Calendar", href: "/calendar" },
    { icon: TrendingUp, label: "Analytics", href: "/analytics" },
    // Competitive analysis: staff review competitor sets and run the RivalIQ
    // deep analysis here; clients reach finished reports from their dashboard.
    ...(isMoburstStaff ? [{ icon: Crosshair, label: "Competitive", href: "/competitive" }] : []),
    // The API page: the docs, each staff member's own keys and, for admins,
    // the tool keys. Also in the account menu below.
    ...(isMoburstStaff ? [{ icon: KeyRound, label: "API", href: "/api-access" }] : []),
    ...(isAdmin ? [{ icon: Gauge, label: "User analytics", href: "/usage" }] : []),
    ...(isAdmin ? [{ icon: Settings, label: "Settings", href: "/settings" }] : []),
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex items-center justify-center h-16 md:h-[80px] border-b border-[rgba(255,255,255,0.05)] px-4 py-3 group-data-[collapsible=icon]:px-2">
        <Link className="transition-opacity hover:opacity-80 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" to="/" aria-label="Socialytics home">
          <img
            src="/images/logo-dark.png"
            alt="Socialytics by Moburst"
            className="h-10 w-auto max-w-[200px] object-contain group-data-[collapsible=icon]:hidden"
          />
          <img src="/images/icon-192.png" alt="" className="hidden h-8 w-8 rounded-[8px] object-contain group-data-[collapsible=icon]:block" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="t-label !text-[#b1b7c1] uppercase tracking-wider">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Switch Tool — only for gOS (moburst.ai) sessions; never shown
                  to legacy tools.moburst.com users, who have no portal to
                  return to. */}
              {isGosSession && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Switch tool"
                    className={`${NAV_ITEM} ${NAV_IDLE}`}
                  >
                    <a href={portalUrl()}>
                      <ExternalLink className="h-[24px] w-[24px]" />
                      <span>Switch tool</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {navItems.map((item) => {
                const section = activeNavigationSection(location.pathname);
                const visibleSection = navItems.some((n) => n.href === section) ? section : "/";
                const isActive = visibleSection === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      asChild
                      tooltip={item.label}
                      className={`${NAV_ITEM} ${isActive ? "nav-active text-white" : NAV_IDLE}`}
                    >
                      <Link to={item.href} aria-current={isActive ? "page" : undefined}>
                        <item.icon className="h-[24px] w-[24px]" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2 border-t border-[rgba(255,255,255,0.05)] group-data-[collapsible=icon]:p-2">
        {/* The account menu: who is signed in, and the pages that belong to the
            account rather than to a client (as on moburst.ai's account menu). */}
        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Account menu" className="w-full text-left glass-inner px-3 py-2.5 flex items-center gap-3 group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:justify-center" title={`${user.name || ""} ${user.email || ""}`.trim()}>
                <div className="relative">
                  <div className="h-8 w-8 rounded-full bg-[#b9e045] flex items-center justify-center text-black t-badge">
                    {user.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-success border-2 border-background" />
                </div>
                <div className="flex-1 min-w-0 group-data-[collapsible=icon]:hidden">
                  <div className="t-body font-medium text-white truncate leading-tight">{user.name}</div>
                  <div className="t-label truncate">{user.email}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="truncate">{user.email || user.name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {isMoburstStaff && (
                <DropdownMenuItem asChild>
                  <Link to="/api-access"><KeyRound aria-hidden className="mr-2 h-4 w-4" />API</Link>
                </DropdownMenuItem>
              )}
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link to="/settings"><Settings aria-hidden className="mr-2 h-4 w-4" />Settings</Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link to="/logout"><LogOut aria-hidden className="mr-2 h-4 w-4" />Sign out</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* Staff can use Socialytics as a client user of one client. While
            they do, they hold the client role, so this is gone with every
            other staff item until they exit. */}
        {user && isMoburstStaff && <PreviewAsClient />}
      </SidebarFooter>
    </Sidebar>
  );
}
