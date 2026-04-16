import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "next-themes";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import ClientSetup from "./pages/ClientSetup";
import RunAnalysis from "./pages/RunAnalysis";
import ReportView from "./pages/ReportView";
import ReportHistory from "./pages/ReportHistory";
import AllReports from "./pages/AllReports";
import Analytics from "./pages/Analytics";
import AnalyticsIndex from "./pages/AnalyticsIndex";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

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
              <Route path="/" element={<Index />} />
              <Route path="/clients/:id/setup" element={<ClientSetup />} />
              <Route path="/clients/:id/analyze" element={<RunAnalysis />} />
              <Route path="/clients/:id/reports/:reportId" element={<ReportView />} />
              <Route path="/clients/:id/reports" element={<ReportHistory />} />
              <Route path="/clients/:id/analytics" element={<Analytics />} />
              <Route path="/analytics" element={<AnalyticsIndex />} />
              <Route path="/reports" element={<AllReports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

