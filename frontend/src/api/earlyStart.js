import { asSpeculative } from "./client.js";
import { likelySignedIn } from "./bookCache.js";
import { getBookById, getBooks } from "./books.js";
import { getUpNext } from "./home.js";
import { getProfile, getStats } from "./profile.js";
import { getLibraryPage, getReadingCapabilities, getReadingHome, getReadingWorkspace, lookupLibraryBooks } from "./reading.js";
import { startEarlyRequest } from "./requestCache.js";
import { browseKey, browseRequestParams, browseScope, readBrowseQuery } from "../components/ui-v2/browseQuery.js";
import { PAGE_SIZE, libraryKey, loadLibraryPage, readLibraryState } from "../components/reading/library/libraryQuery.js";

// A returning reader (the "signed in last time" hint) has a page's data requested together with the account check instead of
// after it: the requests start in the same tick as /auth/refresh, under exactly the keys the pages use, so a page that mounts once
// the check has answered finds its data in the request cache or joins the request still in flight. Nothing is rendered from them
// before the account check says the reader is signed in: RequireAccount and ReadingGate still decide what is shown.
//
// The access cookie lasts fifteen minutes. Inside that time these requests succeed on their own; after it each gets a 401 and
// apiRequest waits for the one shared refresh and retries it once, so the worst case costs what it cost before. A request that
// cannot be answered for this reader (a 401, 403 or 404, an older service) is forgotten without a sound.
//
// The keys below are the single source for these requests: the pages, the contexts and this file all take them from here.
export const profileKey = generation => `profile:${generation}`;
export const capabilitiesKey = generation => `capabilities:${generation}`;
export const lookupKey = (generation, bookId) => `lookup:${generation}:${bookId}`;
export const workspaceKey = (generation, entryId, revision) => `workspace:${generation}:${entryId}:${revision}`;
// Home's requests share one suffix, "generation:revision".
export const homeKeys = suffix => ({ home: `home:${suffix}`, shelf: `home-shelf:${suffix}`, stats: `home-stats:${suffix}`, pins: `home-pins:${suffix}` });
export const loadHomeShelf = () => getLibraryPage({ facet: "all", sort: "added", limit: "100" });

const idFrom = value => (/^\d{1,9}$/.test(value || "") && Number(value) > 0 ? Number(value) : null);

export function startEarly(generation, { pathname = window.location.pathname, search = window.location.search } = {}) {
  if (!likelySignedIn()) return;
  const go = (key, load) => startEarlyRequest(key, () => asSpeculative(load));
  go(profileKey(generation), getProfile);
  go(capabilitiesKey(generation), getReadingCapabilities);
  const path = pathname.replace(/\/+$/, "") || "/";
  const [, first, second] = path.split("/");
  if (path === "/home" || path === "/") {
    // The first visit after sign-in is the revision 0 of the library; Home and the signed-in landing both end up here.
    const keys = homeKeys(`${generation}:0`);
    go(keys.home, getReadingHome);
    go(keys.shelf, loadHomeShelf);
    go(keys.stats, () => getStats());
    go(keys.pins, getUpNext);
  } else if (path === "/my-books") {
    // Coming back from a book restores a longer list under another key; that case asks for itself.
    if (Number(window.history.state?.usr?.libraryLoaded) > PAGE_SIZE) return;
    const state = readLibraryState(new URLSearchParams(search));
    go(libraryKey(generation, state, 0), () => loadLibraryPage(state, "", PAGE_SIZE));
  } else if (path === "/browse") {
    const params = new URLSearchParams(search), query = readBrowseQuery(params, true), scope = browseScope(true, generation, 0, 0);
    go(browseKey(scope, params.toString(), 0), () => getBooks(browseRequestParams(query, scope)));
  } else if (first === "my-books" && idFrom(second) && !path.split("/")[3]) {
    go(workspaceKey(generation, idFrom(second), 0), () => getReadingWorkspace(idFrom(second)));
  } else if (first === "book" && idFrom(second) && !path.split("/")[3]) {
    const id = idFrom(second);
    go(`book:${id}`, () => getBookById(id)); // the key data.js and the book pages use
    go(lookupKey(generation, id), () => lookupLibraryBooks([id]));
  }
}
