import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import existingConfig from "../../../vite.config.js";

const entry = "/src/components/ui-v2/preview.html";
function routeToRedesign(server) {
  server.middlewares.use((request, _response, next) => {
    const path = request.url?.split("?")[0];
    if (path === "/" || (request.headers.accept?.includes("text/html") && /^\/(browse|book|login|register|my-books|preferences|onboarding|account|forgot-password|reset-password)(\/|$)/.test(path))) {
      request.url = entry + (request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "");
    }
    next();
  });
}

export default defineConfig(mergeConfig(existingConfig, {
  plugins: [{ name: "bookvane-isolated-ui-entry", configureServer: routeToRedesign, configurePreviewServer: routeToRedesign }],
  build: { outDir: "src/components/ui-v2/.preview-build", rollupOptions: { input: fileURLToPath(new URL("./preview.html", import.meta.url)) } },
}));
