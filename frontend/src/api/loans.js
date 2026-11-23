import { apiRequest } from "./client.js";

export const listLoans = params => apiRequest(`/me/loans?${new URLSearchParams(params)}`);
export const createLoan = body => apiRequest("/me/loans", { method: "POST", body: JSON.stringify(body) });
export const updateLoan = (id, body) => apiRequest(`/me/loans/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteLoan = id => apiRequest(`/me/loans/${id}`, { method: "DELETE" });
export const shareLoan = id => apiRequest(`/me/loans/${id}/share`, { method: "POST" });
export const revokeLoanShare = id => apiRequest(`/me/loans/${id}/share`, { method: "DELETE" });
// The borrower's page: public, no account.
export const getPublicLoan = token => apiRequest(`/loans/${encodeURIComponent(token)}`);
export const loanGivenBack = token => apiRequest(`/loans/${encodeURIComponent(token)}/back`, { method: "POST" });
