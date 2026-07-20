import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { StaffOnlyRoute } from "@/components/StaffOnlyRoute";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AuthHandoff from "./pages/AuthHandoff";
import { PortalRedirect, Logout } from "./pages/GosPortal";
import ClientSetup from "./pages/ClientSetup";
import RunAnalysis from "./pages/RunAnalysis";
import ReportView from "./pages/ReportView";
import ReportHistory from "./pages/ReportHistory";
import AllReports from "./pages/AllReports";
import Analytics from "./pages/Analytics";
import AnalyticsIndex from "./pages/AnalyticsIndex";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import DevCalendarPreview from "./pages/DevCalendarPreview";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" forcedTheme="dark">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* gOS (moburst.ai) integration endpoints */}
              <Route path="/auth/handoff" element={<AuthHandoff />} />
              <Route path="/login" element={<PortalRedirect />} />
              <Route path="/portal" element={<PortalRedirect />} />
              <Route path="/logout" element={<Logout />} />
              <Route path="/" element={<Index />} />
              {/* Staff-only: client management + cross-client views */}
              <Route path="/clients/:id/setup" element={<StaffOnlyRoute><ClientSetup /></StaffOnlyRoute>} />
              <Route path="/clients/:id/analyze" element={<StaffOnlyRoute><RunAnalysis /></StaffOnlyRoute>} />
              <Route path="/analytics" element={<AnalyticsIndex />} />
              <Route path="/reports" element={<StaffOnlyRoute><AllReports /></StaffOnlyRoute>} />
              <Route path="/settings" element={<StaffOnlyRoute><Settings /></StaffOnlyRoute>} />
              {/* Open to Clients for their own mapped clients only (RLS-scoped) */}
              <Route path="/clients/:id/reports/:reportId" element={<ReportView />} />
              <Route path="/clients/:id/reports" element={<ReportHistory />} />
              <Route path="/clients/:id/analytics" element={<Analytics />} />
              {/* Dev-only — see src/pages/DevCalendarPreview.tsx. Remove after launch. */}
              {import.meta.env.DEV && (
                <Route path="/dev/calendar" element={<DevCalendarPreview />} />
              )}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

