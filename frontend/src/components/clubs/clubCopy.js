// Every string of the clubs redesign, in one place for quick edits. Wording is Michael's approved set with the UI lead's wording review
// (.local-dev/handoffs/clubs-wording-review.md, 24 Nov 2026) applied; the mocks are club-books-tab.html and club-discussion-members.html.

// The club page: This week and the tabs
export const THIS_WEEK = "This week";
export const NOW_READING = "Now reading";
export const readTo = (page, when) => (when ? `Read to ${page} by ${when}` : `Read to ${page}`);
export const youreOn = page => `You’re on p. ${page}.`;
export const pastPage = (count, page) => (count === 1 ? `1 member is past p. ${page}.` : `${count} members are past p. ${page}.`);
export const cardPlace = (page, first) => (first ? `You’re on p. ${page}` : `you’re on p. ${page}`);
export const UP_TO_DATE = "You’re up to date";
export const nextPart = (page, when) => (when ? `Next: ${page} by ${when}.` : `Next: ${page}.`);
export const MAKE_A_READING_PLAN = "Make a reading plan";
export const ADD_TO_MY_SHELF_HELP = "Add it to your shelf to track your page.";
export const ADD_TO_MY_SHELF = "Add to my shelf";
export const NO_BOOK_CHOSEN = "No book chosen yet.";
export const UPDATE_MY_PAGE = "Update my page";
export const CLUB_TABS = [["discussion", "Discussion"], ["books", "Books"], ["members", "Members"]];
export const CLUB_TABS_LABEL = "Club sections";
export const JUST_YOU = "Just you so far";
export const newPosts = count => `${count} new`;

// Set up your club (owners and admins, until the three steps are done)
export const SET_UP_YOUR_CLUB = "Set up your club";
export const STEP_CHOOSE_BOOK = "Choose the first book";
export const CHOOSE_A_BOOK = "Choose a book";
export const STEP_PLAN = "Plan the reading (optional)";
export const STEP_INVITE = "Invite your members";

// Discussion
export const WRITE_A_POST = "Write a post";
export const YOUR_POST = "Your post";
export const POST_PLACEHOLDER = "What did you think?";
export const SPOILERS_UP_TO_PAGE = "Spoilers up to page";
export const SPOILERS_HELP = "Hidden from anyone who hasn’t reached this page.";
export const NO_SPOILERS = "No spoilers";
export const POST = "Post";
export const unlockAt = (count, page) => (count === 1 ? `1 post unlocks at ${page}.` : `${count} posts unlock at ${page}.`);
export const NO_POSTS = "No posts yet.";
export const POSTS_OPEN_WHEN_BOOK = "Posts open once the club picks a book.";
export const OLDER_POSTS = "Older posts";
export const upTo = page => `up to ${page}`;
export const NO_SPOILERS_META = "no spoilers";
export const YOU = "You";
export const REACHED_A_PAGE = "Choose a page you’ve reached.";
export const reachedAPageAt = page => `Choose a page you’ve reached. You’re on p. ${page}.`;
export const EDIT_POST = "Edit post";
export const DELETE_POST = "Delete post";
export const REPORT_POST = "Report post";
export const REMOVE_POST = "Remove post";
export const spoilersFixed = page => `Spoilers up to ${page}`;
export const SAVE = "Save";
export const CANCEL = "Cancel";
export const DELETE_POST_TITLE = "Delete your post?";
export const CANT_UNDO = "This can’t be undone.";
export const removePostTitle = name => `Remove ${name}’s post?`;
export const REPORT_THIS_POST = "Report this post?";
export const REPORT_PRIVACY = "Only the club’s owner and admins see reports.";
export const WHY_OPTIONAL = "Why? (optional)";
export const REPORT = "Report";
export const REPORTED = "Reported.";

// Books (the Books tab)
export const UP_NEXT = "Up next";
export const READ_TOGETHER = "Read together";
export const ADD_A_BOOK = "Add a book";
export const fromDate = date => `From ${date}`;
export const NO_DATE_YET = "No date yet";
export const finishedCount = (done, total) => `${done} of ${total} finished`;
export const byDate = (label, date) => (date ? `${label} by ${date}` : label);
export const endDate = date => `end ${date}`;
export const EDIT_READING_PLAN = "Edit reading plan";
export const FINISH_THIS_BOOK = "Finish this book";
export const REMOVE_BOOK = "Remove book";
export const START_READING_NOW = "Start reading now";
export const REMOVE_FROM_HISTORY = "Remove from history";
export const READ_IT_NOW = "Read it now";
export const READ_IT_NEXT = "Read it next";
export const ADD_TO_CLUB = "Add to club";
export const FINISH_BY = "Finish by";
export const SPLIT_INTO = "Split into";
export const parts = count => (count === 1 ? "1 part" : `${count} parts`);
export const PLAN_HELP = "Pages are split evenly. You can change any part.";
export const SAVE_PLAN = "Save plan";
export const SKIP = "Skip";
export const part = number => `Part ${number}`;
export const toPage = (page, date) => `to ${page} by ${date}`;
export const endBy = date => `End by ${date}`;
export const finishTitle = title => `Finish ${title}?`;
export const finishText = next => (next ? `It moves to Read together. ${next} becomes the club’s book.` : "It moves to Read together. No next book yet.");
export const FINISH_CONFIRM = "Finish book";
export const finishFirstTitle = current => `Finish ${current} first?`;
export const finishFirstText = (current, next) => `${current} moves to Read together, and ${next} becomes the club’s book.`;
export const FINISH_AND_START = "Finish and start";
export const removeBookTitle = title => `Remove ${title} from the club?`;
export const REMOVE_BOOK_TEXT = "Its reading plan and posts are deleted too. This can’t be undone.";

// Members
export const INVITE_PEOPLE = "Invite people";
export const placesUsed = (used, cap) => `${used} of ${cap} places used`;
export const NOT_SHARING = "not sharing";
export const SHARE_MY_PROGRESS = "Share my progress";
export const SHARE_HELP = "Members see the page you’re on.";
export const SHARING_ON = "Sharing on";
export const SHARING_OFF = "Sharing off";
export const seeAll = count => `See all ${count}`;
export const MAKE_ADMIN = "Make admin";
export const MAKE_MEMBER = "Make member";
export const REMOVE_FROM_CLUB = "Remove from club";
export const LEAVE_CLUB = "Leave club";
export const ROLE_MEMBER = "Member";
export const ROLE_ADMIN = "Admin";
export const ROLE_OWNER = "Owner";
export const joined = date => `Joined ${date}`;
export const removeMemberTitle = name => `Remove ${name} from the club?`;
export const REMOVE_MEMBER_TEXT = "They’ll need a new invite to rejoin.";
export const REMOVE = "Remove";
export const leaveTitle = name => `Leave ${name}?`;
export const LEAVE_TEXT = "You’ll need a new invite to rejoin.";
// A full club (owner): kept as it was while Michael decides what happens at the limit
export const CLUB_FULL = "Your club is full.";
export const CLUB_FULL_TEXT = "Club Plus removes the limit.";

// Club size (owners; only when the server sends member_limit)
export const CHANGE = "Change";
export const CLUB_SIZE = "Club size";
export const SIZE_HELP = "Members can join until the club is full.";
export const ADD_PLACES = "Add places";
export const SIZE_CHOICES = [10, 15, 20, 25];
export const SIZE_MAX = 25;

// Invite people
export const SHARE_INVITE_LINK = "Share invite link";
export const LINK_COPIED = "Link copied";
export const STOP_THIS_LINK = "Stop this link";
export const inviteLine = (date, left) => (left == null ? `The link works until ${date}.` : `The link works until ${date}. ${left} ${left === 1 ? "place" : "places"} left.`);

// The owner and admin menu
export const EDIT_CLUB = "Edit club";
export const READING_PLAN = "Reading plan";
export const reportedPosts = count => `Reported posts (${count})`;
export const DELETE_CLUB = "Delete club";
export const deleteClubTitle = name => `Delete ${name}?`;
export const DELETE_CLUB_TEXT = "The discussion and reading plan are deleted for everyone. This can’t be undone.";

// Reported posts
export const REPORTED_POSTS = "Reported posts";
export const reportedTimes = count => (count === 1 ? "reported 1 time" : `reported ${count} times`);
export const KEEP_IT = "Keep it";
export const REMOVE_IT = "Remove it";
export const REPORTED_HELP = "A post reported 3 times is hidden until you decide.";
export const NOTHING_TO_REVIEW = "Nothing to review.";

// Start a club
export const START_HELP = "Add a description and colour later in Edit club.";
