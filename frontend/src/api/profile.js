import { apiRequest } from "./client.js";

const send = (method, body) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const list = id => `/me/lists/${Number(id)}`;

export const getProfile = () => apiRequest("/me/profile");
export const updateProfile = changes => apiRequest("/me/profile", send("PATCH", changes));
export const getStats = () => apiRequest("/me/stats");

export const getLists = bookId => apiRequest(bookId ? `/me/lists?book_id=${Number(bookId)}` : "/me/lists");
export const createList = name => apiRequest("/me/lists", send("POST", { name }));
export const getList = id => apiRequest(list(id));
export const updateList = (id, changes) => apiRequest(list(id), send("PATCH", changes));
export const deleteList = id => apiRequest(list(id), send("DELETE"));
export const addListBook = (id, bookId) => apiRequest(`${list(id)}/books`, send("POST", { book_id: bookId }));
export const removeListBook = (id, bookId) => apiRequest(`${list(id)}/books/${Number(bookId)}`, send("DELETE"));
export const orderList = (id, bookIds) => apiRequest(`${list(id)}/order`, send("PUT", { book_ids: bookIds }));

export const getPublicProfile = handle => apiRequest(`/u/${encodeURIComponent(handle)}`);
export const getPublicList = (handle, id) => apiRequest(`/u/${encodeURIComponent(handle)}/lists/${Number(id)}`);
