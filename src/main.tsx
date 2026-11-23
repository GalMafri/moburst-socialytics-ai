// First, before the Supabase client loads: a browser that blocks site data must not stop the app (storageGuard.ts).
import "./lib/storageGuard";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
