import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import { StaffOnlyRoute } from "@/components/StaffOnlyRoute";
import { AdminOnlyRoute } from "@/components/AdminOnlyRoute";
import { Telemetry } from "@/components/Telemetry";
import { ReturnTo } from "@/components/ReturnTo";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { StrategyOnlyGate } from "@/components/clients/StrategyOnly";
import { ClientAccessGate } from "@/components/clients/ClientAccess";
import { RolePreviewSync } from "@/components/preview/RolePreviewBand";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import AuthHandoff from "./pages/AuthHandoff";
import OAuthConsent from "./pages/OAuthConsent";
import { PortalRedirect, Logout } from "./pages/GosPortal";
import ClientSetup from "./pages/ClientSetup";
import RunAnalysis from "./pages/RunAnalysis";
import CompetitorReview from "./pages/CompetitorReview";
import CompetitiveRun from "./pages/CompetitiveRun";
import CompetitiveIndex from "./pages/CompetitiveIndex";
import CompetitiveReportView from "./pages/CompetitiveReportView";
import CompetitiveReportHistory from "./pages/CompetitiveReportHistory";
import CompetitiveFeed from "./pages/CompetitiveFeed";
import ReportView from "./pages/ReportView";
import ReportHistory from "./pages/ReportHistory";
import AllReports from "./pages/AllReports";
import Analytics from "./pages/Analytics";
import AnalyticsIndex from "./pages/AnalyticsIndex";
import CalendarIndex from "./pages/CalendarIndex";
import ClientCalendar from "./pages/ClientCalendar";
import Settings from "./pages/Settings";
import Usage from "./pages/Usage";
import ApiPage from "./pages/ApiPage";
import ApiReferencePage from "./pages/ApiReferencePage";
import NotFound from "./pages/NotFound";
import StrategyIndex from "./pages/StrategyIndex";
import ClientStrategy from "./pages/ClientStrategy";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" forcedTheme="dark">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ErrorBoundary>
          <AuthProvider>
            <Telemetry />
            <ReturnTo />
            <RolePreviewSync />
            <Routes>
              <Route path="/auth" element={<Auth />} />
              {/* gOS (moburst.ai) integration endpoints */}
              <Route path="/auth/handoff" element={<AuthHandoff />} />
              <Route path="/login" element={<PortalRedirect />} />
              <Route path="/portal" element={<PortalRedirect />} />
              <Route path="/logout" element={<Logout />} />
              {/* Claude connector: Supabase Auth's OAuth consent step */}
              <Route path="/oauth/consent" element={<OAuthConsent />} />
              <Route path="/" element={<Index />} />
              {/* Staff-only: cross-client views. Competitive analysis is staff-only while sets are reviewed;
                  the client-facing surface is the finished deck via RLS. */}
              <Route path="/competitive" element={<StaffOnlyRoute><CompetitiveIndex /></StaffOnlyRoute>} />
              <Route path="/analytics" element={<AnalyticsIndex />} />
              <Route path="/calendar" element={<CalendarIndex />} />
              <Route path="/reports" element={<StaffOnlyRoute><AllReports /></StaffOnlyRoute>} />
              {/* Content strategy: staff only, the team's working draft */}
              <Route path="/strategy" element={<StaffOnlyRoute><StrategyIndex /></StaffOnlyRoute>} />
              <Route path="/settings" element={<StaffOnlyRoute><Settings /></StaffOnlyRoute>} />
              <Route path="/api-access" element={<StaffOnlyRoute><ApiPage /></StaffOnlyRoute>} />
              <Route path="/api-access/reference" element={<StaffOnlyRoute><ApiReferencePage /></StaffOnlyRoute>} />
              {/* The keys page moved to the API page's Tokens tab; /api-docs is the moburst.ai name for the page. */}
              <Route path="/api-keys" element={<Navigate to="/api-access?tab=tokens" replace />} />
              <Route path="/api-docs" element={<Navigate to="/api-access" replace />} />
              <Route path="/usage" element={<AdminOnlyRoute><Usage /></AdminOnlyRoute>} />
              {/* Every page of one client. ClientAccessGate shows one calm sentence, with the way back to the
                  dashboard, when this person cannot read the client (another client's address, an id that does
                  not exist, or, for a client's own user, an archived client); a read that fails closes nothing.
                  Staff pages are staff-only (StaffOnlyRoute). Open to Clients for their own mapped clients only
                  (RLS-scoped): reports, analytics, calendar and the finished competitive reports (status=complete).
                  A strategy-only client's Calendar, Analytics and Reports pages show one sentence in their place
                  (StrategyOnlyGate); its Strategy, setup and competitor pages are as for any client. */}
              <Route path="/clients/:id" element={<ClientAccessGate />}>
                <Route path="setup" element={<StaffOnlyRoute><ClientSetup /></StaffOnlyRoute>} />
                <Route path="analyze" element={<StaffOnlyRoute><StrategyOnlyGate title="Reports"><RunAnalysis /></StrategyOnlyGate></StaffOnlyRoute>} />
                <Route path="competitive" element={<StaffOnlyRoute><CompetitorReview /></StaffOnlyRoute>} />
                <Route path="competitive/run" element={<StaffOnlyRoute><StrategyOnlyGate title="Reports"><CompetitiveRun /></StrategyOnlyGate></StaffOnlyRoute>} />
                <Route path="competitive/feed" element={<StaffOnlyRoute><CompetitiveFeed /></StaffOnlyRoute>} />
                <Route path="competitive/reports" element={<StrategyOnlyGate title="Reports"><CompetitiveReportHistory /></StrategyOnlyGate>} />
                <Route path="competitive/reports/:reportId" element={<StrategyOnlyGate title="Reports"><CompetitiveReportView /></StrategyOnlyGate>} />
                <Route path="strategy" element={<StaffOnlyRoute><ClientStrategy /></StaffOnlyRoute>} />
                <Route path="reports/:reportId" element={<StrategyOnlyGate title="Reports"><ReportView /></StrategyOnlyGate>} />
                <Route path="reports" element={<StrategyOnlyGate title="Reports"><ReportHistory /></StrategyOnlyGate>} />
                <Route path="analytics" element={<StrategyOnlyGate title="Analytics"><Analytics /></StrategyOnlyGate>} />
                <Route path="calendar" element={<StrategyOnlyGate title="Calendar"><ClientCalendar /></StrategyOnlyGate>} />
                <Route path="*" element={<NotFound />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

