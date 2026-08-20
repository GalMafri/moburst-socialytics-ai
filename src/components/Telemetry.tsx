import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { initTelemetry, trackPageView } from "@/lib/telemetry";

/**
 * Mounted once inside the router. Starts the telemetry runtime and reports a
 * page view (plus dwell time on the page being left) for every route change.
 * Route params are collapsed to :id so paths group instead of exploding into
 * one bucket per report.
 */
export function Telemetry() {
  const location = useLocation();

  useEffect(() => {
    initTelemetry();
  }, []);

  useEffect(() => {
    const route = location.pathname
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
      .replace(/\/\d+/g, "/:n");
    trackPageView(location.pathname, route);
  }, [location.pathname]);

  return null;
}
