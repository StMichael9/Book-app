import { API_BASE_URL, apiRequest } from "./client.js";

// Book clubs (backend/routes/clubs.py). Every club answer is private to its members.
const send = (method, body) => ({ method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
const club = id => `/clubs/${Number(id)}`;

export const listClubs = () => apiRequest("/me/clubs");
export const createClub = data => apiRequest("/me/clubs", send("POST", data));
export const joinClub = token => apiRequest("/me/clubs/join", send("POST", { token }));
export const getInvitePreview = token => apiRequest(`/club-invites/${encodeURIComponent(token)}`, { skipRefresh: true });

export const getClub = id => apiRequest(club(id));
export const updateClub = (id, data) => apiRequest(club(id), send("PATCH", data));
export const deleteClub = id => apiRequest(club(id), send("DELETE"));
export const getMembers = id => apiRequest(`${club(id)}/members`);
export const setSharing = (id, shareProgress) => apiRequest(`${club(id)}/me`, send("PATCH", { share_progress: shareProgress }));
export const setMemberRole = (id, userId, role) => apiRequest(`${club(id)}/members/${encodeURIComponent(userId)}`, send("PATCH", { role }));
export const removeMember = (id, userId) => apiRequest(`${club(id)}/members/${encodeURIComponent(userId)}`, send("DELETE"));
export const leaveClub = id => apiRequest(`${club(id)}/leave`, send("POST"));

export const createInvite = id => apiRequest(`${club(id)}/invites`, send("POST", {}));
export const listInvites = id => apiRequest(`${club(id)}/invites`);
export const revokeInvite = (id, inviteId) => apiRequest(`${club(id)}/invites/${encodeURIComponent(inviteId)}`, send("DELETE"));

export const addClubBook = (id, data) => apiRequest(`${club(id)}/books`, send("POST", data));
export const deleteClubBook = (id, clubBookId) => apiRequest(`${club(id)}/books/${Number(clubBookId)}`, send("DELETE"));
export const updateClubBook = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}`, send("PATCH", data));
export const advanceClubBook = (id, clubBookId, nextClubBookId) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/advance`, send("POST", nextClubBookId != null ? { next_club_book_id: Number(nextClubBookId) } : {}));
export const addCheckpoint = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/checkpoints`, send("POST", data));
export const deleteCheckpoint = (id, clubBookId, checkpointId) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/checkpoints/${Number(checkpointId)}`, send("DELETE"));

export const getPosts = (id, clubBookId, before) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/posts${before ? `?before=${Number(before)}` : ""}`);
export const createPost = (id, clubBookId, data) => apiRequest(`${club(id)}/books/${Number(clubBookId)}/posts`, send("POST", data));
export const deletePost = (id, postId) => apiRequest(`${club(id)}/posts/${Number(postId)}`, send("DELETE"));
export const reportPost = (id, postId, reason) => apiRequest(`${club(id)}/posts/${Number(postId)}/report`, send("POST", reason ? { reason } : {}));
export const editPost = (id, postId, body) => apiRequest(`${club(id)}/posts/${Number(postId)}`, send("PATCH", { body }));
export const getReports = id => apiRequest(`${club(id)}/reports`);
export const reviewPost = (id, postId, action) => apiRequest(`${club(id)}/posts/${Number(postId)}/review`, send("POST", { action }));

// Meetings and RSVPs (one upcoming meeting per club), and the vote on the next book.
export const createMeeting = (id, data) => apiRequest(`${club(id)}/meetings`, send("POST", data));
export const updateMeeting = (id, meetingId, data) => apiRequest(`${club(id)}/meetings/${Number(meetingId)}`, send("PATCH", data));
export const setRsvp = (id, meetingId, status) => apiRequest(`${club(id)}/meetings/${Number(meetingId)}/rsvp`, send("PUT", { status }));
export const meetingCalendarUrl = (id, meetingId) => `${API_BASE_URL}${club(id)}/meetings/${Number(meetingId)}.ics`;
export const getSuggestions = id => apiRequest(`${club(id)}/suggestions`);
export const suggestBook = (id, bookId) => apiRequest(`${club(id)}/suggestions`, send("POST", { book_id: bookId }));
export const removeSuggestion = (id, suggestionId) => apiRequest(`${club(id)}/suggestions/${Number(suggestionId)}`, send("DELETE"));
export const setVote = (id, suggestionId, voted) => apiRequest(`${club(id)}/suggestions/${Number(suggestionId)}/vote`, send(voted ? "PUT" : "DELETE"));
export const closeVote = id => apiRequest(`${club(id)}/suggestions/close`, send("POST"));
