import { apiRequest } from "./client.js";

// Admin only: the server answers 403 to everyone else.
export const getAdminOverview = () => apiRequest("/admin/overview");
export const getAdminMetrics = days => apiRequest(`/admin/metrics?days=${Number(days)}`);
