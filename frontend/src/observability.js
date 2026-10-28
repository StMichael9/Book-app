// Error reporting and visit counting. Both are off unless their key is set at build time (VITE_SENTRY_DSN,
// VITE_CF_ANALYTICS_TOKEN); with neither set nothing is loaded, initialised or sent.
const env = (typeof import.meta !== "undefined" && import.meta.env) || {};

let report = null;

// Called by the route error boundary; does nothing unless error reporting was started.
export function reportError(error, info) {
  try { report?.(error, info); } catch { /* Reporting must never break the page. */ }
}

// Only the error itself (type, message, stack) leaves the browser. No cookies, headers, request bodies, query text
// or fragments (a reset link carries its token there), user details, breadcrumbs or extra data.
export function scrubEvent(event) {
  const request = event?.request;
  if (request && typeof request === "object") {
    for (const field of ["cookies", "headers", "data", "query_string"]) delete request[field];
    if (typeof request.url === "string") request.url = request.url.split("#")[0].split("?")[0];
  }
  if (event) for (const field of ["user", "breadcrumbs", "extra"]) delete event[field];
  return event;
}

export async function startObservability(settings = env, load = () => import("@sentry/react")) {
  const dsn = settings.VITE_SENTRY_DSN?.trim();
  if (!dsn) return false;
  const Sentry = await load();
  Sentry.init({
    dsn,
    environment: settings.VITE_SENTRY_ENVIRONMENT || settings.MODE || "production",
    sendDefaultPii: false,
    // Errors only: no session replay and no performance tracing. Breadcrumbs and page context are left out because
    // they can carry what a reader typed or opened.
    integrations: defaults => defaults.filter(item => !["Breadcrumbs", "HttpContext"].includes(item.name)),
    maxBreadcrumbs: 0,
    beforeSend: scrubEvent,
  });
  report = (error, info) => Sentry.captureException(error, info?.componentStack ? { contexts: { react: { componentStack: info.componentStack } } } : undefined);
  return true;
}

let analyticsInstalled = false;

// Cloudflare Web Analytics: counts visits without cookies and without following anyone across sites.
export function installAnalytics(settings = env, doc = typeof document === "undefined" ? null : document) {
  const token = settings.VITE_CF_ANALYTICS_TOKEN?.trim();
  if (!token || !doc || analyticsInstalled) return false;
  const script = doc.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.setAttribute("data-cf-beacon", JSON.stringify({ token }));
  doc.head.append(script);
  analyticsInstalled = true;
  return true;
}
