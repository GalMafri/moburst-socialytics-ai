import React from "react";
import { useLocation } from "react-router-dom";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { track } from "@/lib/telemetry";

interface Props {
  children: React.ReactNode;
  /** Changes when the person moves to another page; the boundary then starts clean. */
  resetKey?: string;
}

interface State {
  hasError: boolean;
}

/**
 * One boundary around the whole app. React already draws the tree a second
 * time after a render error before it commits the boundary, so a half-loaded
 * read gets its second chance there. A render error that survives that is
 * logged for the team and the person sees a calm screen in the app's own
 * layout with the way back to the dashboard. The error's own text is never
 * shown.
 */
class Boundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Render error", error, info.componentStack);
    track("render_error", { name: error.name });
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#0b0c10] intercept-bg p-page">
          <div className="relative z-10 w-full max-w-md glass p-card">
            <EmptyState
              framed={false}
              icon={Compass}
              title="This page needs a fresh start"
              description="Head back to the dashboard and open it again."
              action={
                <Button asChild>
                  <a href="/">Go to the dashboard</a>
                </Button>
              }
            />
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <Boundary resetKey={pathname}>{children}</Boundary>;
}
