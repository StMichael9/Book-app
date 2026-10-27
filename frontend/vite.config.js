import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// A fresh id per build, so a cached book list from an older deploy is never shown.
const buildId = process.env.VITE_BUILD_ID || Date.now().toString(36);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
});
