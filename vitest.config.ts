import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { applyPublicEnvDefaults } from "./public-env";

// Tests import the Supabase client, which throws at module load without a URL.
// .env is untracked and optional, so the same public defaults the build uses
// have to apply here too — otherwise a clean checkout passes the build and
// fails the tests.
applyPublicEnvDefaults();

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
