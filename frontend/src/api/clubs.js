import { apiRequest } from "./client.js";

// Book clubs (backend/routes/clubs.py). Every club answer is private to its members.
const send = (method, body) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const club = id => `/clubs/${Number(id)}`;

export const listClubs = () => apiRequest("/me/clubs");
export const createClub = data => apiRequest("/me/clubs", send("POST", data));
export const joinClub = token => apiRequest("/me/clubs/join", send("POST", { token }));
export const getInvitePreview = token => apiRequest(`/club-invites/${encodeURIComponent(token)}`, { skipRefresh: true });

export const getClub = id => apiRequest(club(id));
export const updateClub = (id, data) => apiRequest(club(id), send("PATCH", data));
export const getMembers = id => apiRequest(`${club(id)}/members`);
export const setSharing = (id, shareProgress) => apiRequest(`${club(id)}/me`, send("PATCH", { share_progress: shareProgress }));
export const setMemberRole = (id, userId, role) => apiRequest(`${club(id)}/members/${encodeURIComponent(userId)}`, send("PATCH", { role }));
export const removeMember = (id, userId) => apiRequest(`${club(id)}/members/${encodeURIComponent(userId)}`, send("DELETE"));
export const leaveClub = id => apiRequest(`${club(id)}/leave`, send("POST"));

export const createInvite = id => apiRequest(`${club(id)}/invites`, send("POST", {}));
export const listInvites = id => apiRequest(`${club(id)}/invites`);
export const revokeInvite = (id, inviteId) => apiRequest(`${club(id)}/invites/${encodeURIComponent(inviteId)}`, send("DELETE"));

export const addClubBook = (id, data) => apiRequest(`${club(id)}/books`, send("POST", data));
export const updateClubBook = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}`, send("PATCH", data));
export const addCheckpoint = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/checkpoints`, send("POST", data));
export const deleteCheckpoint = (id, clubBookId, checkpointId) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/checkpoints/${Number(checkpointId)}`, send("DELETE"));

export const getPosts = (id, clubBookId, before) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/posts${before ? `?before=${Number(before)}` : ""}`);
export const createPost = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/posts`, send("POST", data));
export const deletePost = (id, postId) => apiRequest(`${club(id)}/posts/${Number(postId)}`, send("DELETE"));
export const reportPost = (id, postId) => apiRequest(`${club(id)}/posts/${Number(postId)}/report`, send("POST", {}));
