import { apiRequest } from "./client.js";

// Up next pins (T41). `PUT` replaces the whole list (at most 5) and answers with the same shape as `GET`.
export const getUpNext = () => apiRequest("/me/up-next");
export const putUpNext = entryIds => apiRequest("/me/up-next", { method: "PUT", body: JSON.stringify({ entry_ids: entryIds }) });
