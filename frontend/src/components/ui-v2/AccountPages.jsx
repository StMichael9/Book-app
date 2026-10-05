import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Mail, Moon, Sun } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { getBookById } from "../../api/books.js";
import { getPreferences, savePreferences } from "../../api/preferences.js";
import { requestPasswordReset, resetPassword } from "../../api/auth.js";
import { useReader } from "./readerState.js";
import { errorText, loadSubjectOptions, safeReturnTo, subjectLabel, useRequest, validBookId } from "./data.js";
import { ActionLink, BookCover, BookGrid, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "./primitives.jsx";

export function RequireAccount({ children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.isLoading) return <section className="bv-container bv-section" role="status"><p className="bv-muted">Checking your account…</p></section>;
  if (!auth.isAuthenticated) return <Navigate replace to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} />;
  return children;
}

function PasswordField({ label = "Password", creating = false }) {
  const [visible, setVisible] = useState(false);
  return <div className="bv-field"><label htmlFor="bv-password">{label}</label><div className="bv-password-wrap">
    <input id="bv-password" name="password" type={visible ? "text" : "password"} autoComplete={creating ? "new-password" : "current-password"} minLength={creating ? 8 : undefined} maxLength={128} required aria-describedby="bv-password-help" />
    <Button variant="quiet" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible}>{visible ? "Hide" : "Show"}</Button>
  </div><small id="bv-password-help">{creating ? "Use 8–128 characters. You can paste or use your password manager." : "You can use your password manager."}</small></div>;
}

function accountIntent(params) {
  const returnTo = safeReturnTo(params.get("returnTo"));
  const id = validBookId(params.get("bookId"));
  const status = params.get("save");
  const intent = id && ["want", "owned"].includes(status) && new URL(returnTo, window.location.origin).pathname === `/book/${id}` ? { id, status } : null;
  return { returnTo, intent };
}

export function AuthPage({ register = false }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { returnTo, intent } = accountIntent(params);
  const pendingBook = useRequest(() => getBookById(intent.id), `pending:${intent?.id || "none"}`, Boolean(intent));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const destination = intent ? (() => {
    const url = new URL(returnTo, window.location.origin); url.searchParams.set("save", intent.status); return url.pathname + url.search;
  })() : returnTo;
  useEffect(() => { if (auth.isAuthenticated && !auth.isLoading && !pending) navigate(destination, { replace: true }); }, [auth.isAuthenticated, auth.isLoading, pending, destination, navigate]);
  async function submit(event) {
    event.preventDefault(); if (pending) return;
    const values = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      const credentials = { email: String(values.get("email")).trim(), password: String(values.get("password")) };
      if (register) await auth.register(credentials); else await auth.login(credentials);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(errorText(requestError, register ? "Your account couldn’t be created. Please try again." : "You couldn’t be signed in. Please try again."));
    } finally { setPending(false); }
  }
  const switchPath = `${register ? "/login" : "/register"}${params.size ? `?${params}` : ""}`;
  return <section className="bv-container"><div className="bv-auth-layout">
    <aside className="bv-auth-story"><p className="bv-eyebrow">Your next chapter starts here</p><h2>A little shelf.<br />A lot of possibility.</h2><p className="bv-muted">The books you own. The ones you’re curious about. A library you can come back to.</p>
      {pendingBook.data ? <div className="bv-auth-story-cover"><BookCover book={pendingBook.data} priority /></div> : <div className="bv-auth-story-shelves"><BookOpen aria-hidden="true" /><p><strong>Own</strong>The ones you know.</p><p><strong>Want</strong>The next possibilities.</p></div>}
    </aside>
    <div className="bv-auth-card"><PageHeading title={register ? "Start your library." : "Welcome back."}>{register ? "Keep your discoveries in one place." : "Your books are right where you left them."}</PageHeading>
      {intent && <div className="bv-pending-book">{pendingBook.data && <BookCover book={pendingBook.data} priority />}<p><strong>{pendingBook.data?.title || "Your chosen book"}</strong>Ready to add to your {intent.status === "owned" ? "Own" : "Want"} shelf after you sign in.</p></div>}
      <form onSubmit={submit} aria-busy={pending}>
        {error && <p className="bv-field-error" role="alert">{error}</p>}
        <div className="bv-field"><label htmlFor="bv-auth-email">Email address</label><input id="bv-auth-email" type="email" name="email" autoComplete="email" required placeholder="you@example.com" /></div>
        <PasswordField creating={register} />
        {!register && <TextLink to="/forgot-password">Forgot password?</TextLink>}
        <Button type="submit" className="bv-full-width" disabled={pending}>{pending ? register ? "Creating your account…" : "Signing in…" : register ? "Create account" : "Sign in"}</Button>
      </form><p className="bv-auth-switch">{register ? "Already have an account? " : "New to Bookvane? "}<TextLink to={switchPath}>{register ? "Sign in" : "Create an account"}</TextLink></p>
      <TextLink to="/browse"><ArrowLeft aria-hidden="true" />Back to books</TextLink>
    </div>
  </div></section>;
}

export function MyBooksPage() {
  const library = useUserBooks();
  const reader = useReader();
  const [params, setParams] = useSearchParams();
  const status = params.get("status") === "owned" ? "owned" : "want";
  const rows = Object.values(library.booksById);
  const loading = !reader.libraryReady || library.loading;
  const items = rows.filter((item) => item.status === status).map((item) => item.book).filter(Boolean);
  return <section className="bv-container"><div className="bv-library-heading"><PageHeading eyebrow="A little more you" title="My Books">Your collection. Your next possibilities.</PageHeading><ActionLink to="/browse" variant="secondary"><SearchIcon />Find more</ActionLink></div>
    <div className="bv-tabs" role="tablist" aria-label="Your shelves" onKeyDown={(event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const next = event.key === "Home" ? "want" : event.key === "End" ? "owned" : status === "want" ? "owned" : "want";
      setParams({ status: next }); event.currentTarget.querySelector(`[data-shelf="${next}"]`)?.focus();
    }}>{["want", "owned"].map((value) => <button key={value} type="button" role="tab" id={`bv-tab-${value}`} data-shelf={value}
      aria-selected={status === value} aria-controls="bv-shelf-panel" tabIndex={status === value ? 0 : -1}
      onClick={() => setParams({ status: value })}>{value === "want" ? "Want" : "Own"}<span>{loading || library.error ? "…" : rows.filter((row) => row.status === value).length}</span></button>)}</div>
    <div id="bv-shelf-panel" role="tabpanel" aria-labelledby={`bv-tab-${status}`}><p className="bv-library-caption bv-muted">{status === "want" ? "The books that caught your eye. Pick up where your curiosity left off." : "The books you call your own. Familiar favourites, all together."}</p>
      {loading ? <BookSkeletons /> : library.error ? <EmptyState error icon={BookOpen} title="Your library couldn’t load." action={<Button onClick={library.retryLoad}>Try again</Button>}>Your books may still be saved. Try again before making changes.</EmptyState> : items.length ? <BookGrid books={items} bookshop={status === "want"} /> : <EmptyState icon={BookOpen} title={status === "want" ? "Your next discovery belongs here." : "Give your books a home."} action={<ActionLink to="/browse">Discover books</ActionLink>}>{status === "want" ? "Find a book that interests you, then choose Want to keep it here." : "Find a book you already have and choose Own to start your collection."}</EmptyState>}
    </div>
  </section>;
}

function SearchIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10" cy="10" r="6.5" /><path d="m15 15 5 5" /></svg>; }

export function PreferencesPage() {
  const request = useRequest(async () => {
    const preferences = await getPreferences();
    if (!Array.isArray(preferences) || preferences.some((item) => !Number.isInteger(item.tag_id) || !item.tag)) throw new Error("Unable to load preferences.");
    const options = await loadSubjectOptions();
    return { preferences, options: [...new Map([...options, ...preferences.map((item) => item.tag)].map((tag) => [tag.id, tag])).values()] };
  }, "preferences");
  return <section className="bv-container bv-preferences"><PageHeading eyebrow="Follow your interests" title="Your discovery subjects">Choose what you enjoy. Books that match these subjects appear first when you browse. You can still explore everything.</PageHeading>
    {request.loading ? <p className="bv-loading-message" role="status">Loading your saved choices…</p> : request.error ? <EmptyState error title="Your preferences couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your saved preferences haven’t changed. Try again to see your choices.</EmptyState> : <PreferencesEditor data={request.data} />}
  </section>;
}

function PreferencesEditor({ data }) {
  const navigate = useNavigate();
  const reader = useReader();
  const [selected, setSelected] = useState(() => data.preferences.map((item) => item.tag_id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); if (saving) return;
    setSaving(true); setError("");
    try {
      await savePreferences({ tagIds: selected, sourceText: data.preferences[0]?.source_text || "" });
      reader.preferencesSaved(); reader.announce("Your discovery subjects are saved."); navigate("/browse");
    } catch (requestError) { setError(errorText(requestError, "Your preferences couldn’t be saved. Your choices are still here.")); }
    finally { setSaving(false); }
  }
  return <form onSubmit={submit} aria-busy={saving}>
      <fieldset className="bv-preference-panel"><legend>What catches your eye?</legend><p className="bv-muted">Choose as many or as few as you like. This is optional.</p><div className="bv-preference-grid">{data.options.map((tag) => <label className="bv-check-tile" key={tag.id}><input type="checkbox" checked={selected.includes(tag.id)} disabled={saving} onChange={(event) => setSelected((current) => event.target.checked ? [...current, tag.id] : current.filter((value) => value !== tag.id))} /><span>{subjectLabel(tag.name)}</span></label>)}</div>
        {!data.options.length && <p>No subjects are available yet. You can keep exploring all books.</p>}
      </fieldset>{error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={saving}>{saving ? "Saving preferences…" : "Save preferences"}</Button><TextLink to="/browse">Back to discovery</TextLink></div>
    </form>;
}

export function RecoveryPage({ reset = false }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(() => reset ? new URLSearchParams(location.hash.slice(1)).get("token") : null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(reset && !token);
  const [error, setError] = useState("");
  const incomingToken = reset ? new URLSearchParams(location.hash.slice(1)).get("token") : null;
  if (incomingToken && (incomingToken !== token || done || expired)) {
    setToken(incomingToken); setDone(false); setExpired(false); setError("");
  }
  useEffect(() => { if (reset && location.hash) navigate({ pathname: location.pathname, search: location.search }, { replace: true }); }, [reset, location.hash, location.pathname, location.search, navigate]);
  async function submit(event) {
    event.preventDefault(); if (pending || expired) return;
    const values = new FormData(event.currentTarget); setPending(true); setError("");
    try {
      if (reset) await resetPassword(token, String(values.get("password"))); else await requestPasswordReset(String(values.get("email")).trim());
      setDone(true);
    } catch (requestError) {
      if (reset && [400, 404, 410, 422].includes(requestError.status)) setExpired(true);
      else setError(errorText(requestError, "We couldn’t complete your request. Please try again."));
    } finally { setPending(false); }
  }
  return <section className="bv-container"><div className="bv-narrow">{!done && <TextLink to="/login"><ArrowLeft aria-hidden="true" />Back to sign in</TextLink>}
    {expired ? <><PageHeading title="This link is no longer valid.">Request a new reset link to get back to your books. Your account is still there.</PageHeading><ActionLink to="/forgot-password">Send a new link</ActionLink></> : done ? <>
      {!reset && <div className="bv-medallion"><Mail aria-hidden="true" /></div>}<PageHeading title={reset ? "A fresh start." : "Check your inbox."}>{reset ? "Your password is updated. You can sign in again." : "If an account exists for that email address, we’ll send a link to reset your password."}</PageHeading>
      {!reset && <p className="bv-notice">Not there yet? Check your spam folder, or try another email address.</p>}<ActionLink to="/login">Back to sign in</ActionLink>{!reset && <Button variant="quiet" onClick={() => setDone(false)}>Try another email address</Button>}
    </> : <><PageHeading title={reset ? "A fresh start." : "Forgot your password?"}>{reset ? "Choose a new password for your Bookvane account." : "Enter the email address you used for Bookvane. We’ll help you get back to your books."}</PageHeading>
      <form onSubmit={submit} aria-busy={pending}>{reset ? <PasswordField label="New password" creating /> : <div className="bv-field"><label htmlFor="bv-recovery-email">Email address</label><input id="bv-recovery-email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" /></div>}
        {error && <p className="bv-field-error" role="alert">{error}</p>}<Button type="submit" className="bv-full-width" disabled={pending}>{pending ? "Working…" : reset ? "Reset password" : "Send reset link"}</Button>
      </form></>}
  </div></section>;
}

export function AccountPage() {
  const auth = useAuth();
  const reader = useReader();
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setLoggingOut(true); setError("");
    try { await auth.logout(); } catch (requestError) { setError(errorText(requestError, "You couldn’t be signed out. Please try again.")); setLoggingOut(false); }
  }
  return <section className="bv-container"><div className="bv-account"><PageHeading eyebrow="Your corner of Bookvane" title={auth.isAuthenticated ? "Make yourself at home." : "A library to call your own."}>{auth.isAuthenticated ? "Your books, your subjects, your way of browsing." : "Save the books that interest you and keep the ones you own together. Join when you’re ready."}</PageHeading>
    {auth.isLoading ? <p role="status">Checking your account…</p> : auth.isAuthenticated ? <><div className="bv-account-row"><div><strong>My Books</strong><span>Your Own and Want shelves</span></div><TextLink to="/my-books">View books <ArrowRight aria-hidden="true" /></TextLink></div>
      <div className="bv-account-row"><div><strong>Discovery subjects</strong><span>What catches your eye</span></div><TextLink to="/preferences">Choose subjects</TextLink></div></> : <div className="bv-form-actions"><ActionLink to="/register">Create account</ActionLink><TextLink to="/login">Sign in</TextLink></div>}
    <div className="bv-account-row"><div><strong>Appearance</strong><span>{reader.theme === "dark" ? "Dark" : "Light"} theme</span></div><Button variant="secondary" onClick={() => reader.setTheme((value) => value === "dark" ? "light" : "dark")}>{reader.theme === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}Switch theme</Button></div>
    {auth.isAuthenticated && <div className="bv-account-row"><div><strong>Account</strong><span>Come back to your books anytime.</span></div><Button variant="quiet" disabled={loggingOut} onClick={logout}>{loggingOut ? "Signing out…" : "Sign out"}</Button></div>}
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </div></section>;
}
