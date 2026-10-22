import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ArrowRight, BookOpen, Bookmark, House, Moon, Search, Sun, User } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { ReaderProvider } from "./ReaderContext.jsx";
import { useReader } from "./readerState.js";
import { AccountPage, AuthPage, MyBooksPage, PreferencesPage, RecoveryPage, RequireAccount } from "./AccountPages.jsx";
import { BookPage, BrowsePage, WelcomePage } from "./DiscoveryPages.jsx";
import { ActionLink, BookCover, BookSkeletons, Button, EmptyState, LibraryWarning, NativeDialog, TextLink } from "./primitives.jsx";
import { safeReturnTo } from "./data.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { PrivateBookPage, ReadingGate, ReadingHomePage, ReadingWorkspacePage, StartReadingPage } from "../reading/ReadingPages.jsx";
import { ReadingDataPage, ReadingPrivacyPage } from "../reading/ReadingDataControls.jsx";
import ReadingDraftProvider from "../reading/ReadingDraftProvider.jsx";
import LibraryNavigationProvider from "../reading/LibraryNavigationProvider.jsx";
import "../../styles/ui-v2/bookvane.css";
import "../../styles/ui-v2/refinement.css";

const LibraryImportPage = lazy(() => import("../reading/imports/LibraryImportPage.jsx"));

function Brand() {
  const { readingActions } = useUserBooks();
  return <Link className="bv-brand" to={readingActions ? "/home" : "/"} aria-label="Bookvane home"><img src="/bookvane-logo.png" alt="" width="35" height="35" /><span>Bookvane</span></Link>;
}

function Header() {
  const auth = useAuth();
  const reader = useReader();
  const { readingActions } = useUserBooks();
  const location = useLocation();
  const discover = ["/", "/browse"].includes(location.pathname) || location.pathname.startsWith("/book/");
  const library = location.pathname.startsWith("/my-books");
  const home = location.pathname === "/home";
  const account = !discover && !library && !home;
  const authScreen = ["/login", "/register", "/forgot-password", "/reset-password"].includes(location.pathname);
  const publicLanding = location.pathname === "/" && !auth.isAuthenticated;
  const mobileNav = useRef(null);
  useLayoutEffect(() => {
    const nav = mobileNav.current, root = nav?.closest(".bv-root");
    if (!nav || !root) return undefined;
    let active = true;
    const measure = () => {
      if (!active) return;
      const height = nav.getBoundingClientRect().height;
      // Keep clearance when the keyboard temporarily hides the navigation.
      if (height > 0) root.style.setProperty("--bv-mobile-nav-clearance", `${Math.ceil(height) + 8}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    measure();
    return () => { active = false; observer.disconnect(); root.style.removeProperty("--bv-mobile-nav-clearance"); };
  }, [publicLanding]);
  return <><header className="bv-header"><div className="bv-container bv-header-inner"><Brand />
    <nav className="bv-desktop-nav" aria-label="Main navigation">{readingActions && <Link className={home ? "bv-active" : ""} aria-current={home ? "page" : undefined} to="/home">Home</Link>}<Link className={discover && !publicLanding ? "bv-active" : ""} aria-current={discover && !publicLanding ? "page" : undefined} to="/browse">Discover</Link>{!publicLanding && <Link className={library ? "bv-active" : ""} aria-current={library ? "page" : undefined} to="/my-books">My Books</Link>}{auth.isAuthenticated && !readingActions && <Link className={location.pathname === "/preferences" ? "bv-active" : ""} to="/preferences">Preferences</Link>}</nav>
    <div className={`bv-header-actions${auth.isAuthenticated ? "" : " bv-header-actions--guest"}`}><Button variant="quiet" className="bv-desktop-theme bv-icon-button" aria-label={`Use ${reader.theme === "dark" ? "light" : "dark"} theme`} onClick={() => reader.setTheme((value) => value === "dark" ? "light" : "dark")}>{reader.theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
      {!authScreen && (auth.isLoading ? <span className="bv-header-check" role="status">{auth.sessionError ? "Account unavailable" : "Checking account…"}</span> : auth.isAuthenticated ? <ActionLink variant="quiet" to="/account" aria-label="Your account"><User aria-hidden="true" /><span className="bv-desktop-label">Your account</span></ActionLink> : <><ActionLink variant="quiet" to="/login">Sign in</ActionLink>{!publicLanding && <ActionLink variant="secondary" to="/register">Join free</ActionLink>}</>)}
    </div>
  </div></header>{!publicLanding && <nav ref={mobileNav} className={`bv-mobile-nav${readingActions ? " bv-mobile-nav--reading" : ""}`} aria-label="Mobile navigation">
    {[...(readingActions ? [["/home", "Home", House, home]] : []), ["/browse", "Discover", Search, discover], ["/my-books", "My Books", BookOpen, library], ["/account", "You", User, account]].map(([to, label, Icon, active]) => <Link key={to} to={to} className={active ? "bv-active" : ""} aria-current={active ? "page" : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>)}
  </nav>}</>;
}

function LandingRoute() {
  const auth = useAuth(), library = useUserBooks();
  if (auth.isLoading || (auth.isAuthenticated && library.loading)) return <section className="bv-container bv-landing-loading" aria-busy="true"><p role="status">Opening Bookvane…</p><BookSkeletons count={3} /></section>;
  return library.readingActions ? <Navigate to="/home" replace /> : <WelcomePage />;
}

function Footer() {
  return <footer className="bv-footer"><div className="bv-container bv-footer-inner"><Brand /><TextLink to="/privacy">Privacy</TextLink></div></footer>;
}

function SessionStatus() {
  const auth = useAuth();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!auth.isLoading || auth.sessionError) return undefined;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [auth.isLoading, auth.sessionError]);
  if (auth.sessionError) return <section className="bv-container bv-section" role="alert">
    <h2>We couldn’t check your account.</h2><p className="bv-muted">{auth.sessionError}</p>
    <Button onClick={auth.retrySession}>Try account check again</Button>
  </section>;
  if (!slow || !auth.isLoading) return null;
  return <section className="bv-container bv-section" role="status">
    <p>The server is taking longer than usual.</p>
    <p className="bv-muted">It may be waking up. Keep this page open; you don’t need to switch pages or sign in again.</p>
  </section>;
}

function AccountPrompt() {
  const reader = useReader();
  const location = useLocation();
  const gate = reader.gate;
  const candidate = safeReturnTo(location.pathname === "/browse" ? location.pathname + location.search : new URLSearchParams(location.search).get("from") || location.state?.browseFrom, "/browse");
  const browseFrom = candidate.split("?")[0] === "/browse" ? candidate : "/browse";
  const query = gate ? new URLSearchParams({
    returnTo: `/book/${gate.book.id}?from=${encodeURIComponent(browseFrom)}`,
    bookId: String(gate.book.id), save: gate.status,
  }).toString() : "";
  return <NativeDialog open={Boolean(gate)} onClose={() => reader.setGate(null)} title="Make room for this book." className="bv-account-prompt">
    {gate && <><div className="bv-medallion"><Bookmark aria-hidden="true" /></div><p className="bv-muted">Create a free account to save books you want and keep track of the ones you own.</p>
      <div className="bv-pending-book"><BookCover book={gate.book} priority /><p><strong>{gate.book.title}</strong>Ready to save as {gate.status === "owned" ? "Owned" : "Want to read"}.</p></div>
      <ActionLink to={`/register?${query}`} onClick={() => reader.setGate(null)}>Create an account</ActionLink><p>Already here? <TextLink to={`/login?${query}`} onClick={() => reader.setGate(null)}>Sign in</TextLink></p>
      <Button variant="quiet" onClick={() => reader.setGate(null)}>Keep browsing</Button></>}
  </NativeDialog>;
}

function RouteEffects() {
  const location = useLocation();
  const first = useRef(true);
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    if (!first.current) {
      const heading = document.querySelector("#bv-main h1");
      heading?.setAttribute("tabindex", "-1"); heading?.focus({ preventScroll: true });
    }
    first.current = false;
    const titles = { "/": "Your personal reading home", "/browse": "Discover", "/home": "Your reading home", "/my-books": "My Books", "/my-books/private": "Add a private book", "/preferences": "Discovery subjects", "/login": "Sign in", "/register": "Create account", "/account": "Your account", "/forgot-password": "Password recovery", "/reset-password": "Reset password" };
    document.title = `${titles[location.pathname] || ({ "/my-data": "Your reading data", "/privacy": "Privacy", "/my-books/import": "Bring your library" })[location.pathname] || (location.pathname.startsWith("/my-books/") ? "Your reading" : "Book details")} · Bookvane`;
  }, [location.pathname]);
  useEffect(() => {
    function keepFocusVisible(event) {
      if (!window.matchMedia("(max-width: 700px)").matches || !(event.target instanceof HTMLElement)) return;
      // Touch browsers may focus main before activating a book link. Its
      // bottom is the whole catalogue, so scrolling it moves the tap target.
      if (event.target.matches("main")) return;
      const nav = document.querySelector(".bv-mobile-nav");
      if (!nav || !nav.getClientRects().length || nav.contains(event.target) || event.target.closest("dialog")) return;
      const target = event.target.getBoundingClientRect();
      const top = nav.getBoundingClientRect().top;
      if (target.bottom + 12 > top) window.scrollBy({ top: target.bottom - top + 24, behavior: "instant" });
    }
    document.addEventListener("focusin", keepFocusVisible);
    return () => document.removeEventListener("focusin", keepFocusVisible);
  }, []);
  return null;
}

function Shell() {
  const reader = useReader();
  const location = useLocation();
  const auth = useAuth();
  return <div className={`bv-root${location.pathname === "/" && !auth.isAuthenticated ? " bv-root--landing" : ""}`} data-theme={reader.theme}>
    <a className="bv-skip" href="#bv-main">Skip to content</a><RouteEffects /><Header />
    <main id="bv-main" tabIndex={-1}><SessionStatus /><div className="bv-container"><LibraryWarning /></div>
      <Routes>
        <Route path="/" element={<LandingRoute />} /><Route path="/browse" element={<BrowsePage />} /><Route path="/book/:bookId" element={<BookPage />} />
        <Route path="/login" element={<AuthPage />} /><Route path="/register" element={<AuthPage register />} />
        <Route path="/forgot-password" element={<RecoveryPage key="forgot" />} /><Route path="/reset-password" element={<RecoveryPage key="reset" reset />} />
        <Route path="/my-books" element={<RequireAccount><MyBooksPage /></RequireAccount>} />
        <Route path="/my-books/import" element={<RequireAccount><ReadingGate><Suspense fallback={<p className="bv-container" role="status">Opening your library import…</p>}><LibraryImportPage /></Suspense></ReadingGate></RequireAccount>} />
        <Route path="/home" element={<RequireAccount><ReadingGate><ReadingHomePage /></ReadingGate></RequireAccount>} />
        <Route path="/my-data" element={<RequireAccount><ReadingGate><ReadingDataPage key={location.pathname} /></ReadingGate></RequireAccount>} />
        <Route path="/privacy" element={<ReadingPrivacyPage />} />
        <Route path="/my-books/private" element={<RequireAccount><ReadingGate><PrivateBookPage key={`${auth.sessionGeneration}:${location.key}`} /></ReadingGate></RequireAccount>} />
        <Route path="/my-books/start/:bookId" element={<RequireAccount><ReadingGate><StartReadingPage key={location.pathname} /></ReadingGate></RequireAccount>} />
        <Route path="/my-books/:entryId" element={<RequireAccount><ReadingGate><ReadingWorkspacePage key={location.pathname} /></ReadingGate></RequireAccount>} />
        <Route path="/preferences" element={<RequireAccount><PreferencesPage /></RequireAccount>} />
        <Route path="/onboarding" element={<Navigate replace to="/preferences" />} /><Route path="/account" element={<AccountPage />} />
        <Route path="*" element={<section className="bv-container"><EmptyState title="This page isn’t on the shelf." action={<ActionLink to="/browse">Discover books <ArrowRight aria-hidden="true" /></ActionLink>}>Try discovery or return to your library.</EmptyState></section>} />
      </Routes>
    </main><Footer /><AccountPrompt /><div className="bv-toast" role="status" aria-live="polite" aria-atomic="true">{reader.message}</div>
  </div>;
}

// Uses the existing Router, AuthProvider and UserBooksProvider supplied by main.
export default function BookvaneApp() { return <ReaderProvider><ReadingDraftProvider><LibraryNavigationProvider><Shell /></LibraryNavigationProvider></ReadingDraftProvider></ReaderProvider>; }
