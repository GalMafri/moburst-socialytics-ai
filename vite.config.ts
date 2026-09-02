import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Public production values. .env is no longer tracked in git (it only ever
// held these same public VITE_* values, and a hand-edited copy on the deploy
// host blocked every deploy for months). Anything a .env or the process
// environment already provides wins; these only fill gaps, so a missing .env
// can never produce a bundle that cannot reach Supabase or the Hub.
const PUBLIC_DEFAULTS: Record<string, string> = {
  VITE_SUPABASE_PROJECT_ID: "rwouwxqggjjacbpbhqsn",
  VITE_SUPABASE_URL: "https://rwouwxqggjjacbpbhqsn.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ3b3V3eHFnZ2pqYWNicGJocXNuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA3MjI5MjUsImV4cCI6MjA4NjI5ODkyNX0.MVh6NOBLeBFvgYlxa9Ye9y6fTX3fQrMuo-YcwwJL5hU",
  VITE_HUB_BACKEND_URL: "https://tools-server.moburst.com",
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_");
  for (const [key, value] of Object.entries(PUBLIC_DEFAULTS)) {
    if (!fileEnv[key] && !process.env[key]) process.env[key] = value;
  }
  return {
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  };
});
