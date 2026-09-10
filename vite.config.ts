import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { applyPublicEnvDefaults, REQUIRED_ENV } from "./public-env";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_");
  applyPublicEnvDefaults(fileEnv);

  // Backstop for a required value that has no default in public-env.ts — a newly
  // added variable, say. Today's four are all defaulted, so this stays quiet. It
  // exists so the next missing one is a red build rather than a bundle that looks
  // fine and renders nothing.
  if (command === "build") {
    const missing = REQUIRED_ENV.filter((k) => !fileEnv[k] && !process.env[k]);
    if (missing.length) {
      throw new Error(
        `Missing required build env with no default: ${missing.join(", ")}.\n` +
          `Add it to PUBLIC_DEFAULTS in public-env.ts (public values only) or ` +
          `provide it via .env. Building without it renders a blank page.`,
      );
    }
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
