import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { getAdminMetrics, getAdminOverview } from "../../api/admin.js";
import { Button } from "./primitives.jsx";
import "../../styles/ui-v2/admin.css";

const PERIODS = [7, 30, 90];
const SOURCES = [["tt", "TikTok"], ["ig", "Instagram"], ["rd", "Reddit"], ["ph", "Product Hunt"], ["yt", "YouTube"], ["x", "X"], ["club", "Clubs"], ["share", "Shares"], ["email", "Email"], ["loan", "Loans"]];
const SCAN_ROWS = [["scan_timeout", "Gave up after 8 seconds"], ["scan_non_isbn", "Barcode wasn’t an ISBN"], ["scan_typed", "Typed the ISBN instead"], ["scan_engine_native", "Read by the phone’s own reader"],
  ["scan_engine_wasm", "Read by the built-in reader"], ["scan_snap_isbn", "Snapped an ISBN"], ["scan_snap_cover", "Snapped a cover"], ["scan_library_code", "Library sticker seen"]];

const number = value => new Intl.NumberFormat("en-US").format(Number(value) || 0);
const dollars = minorUnits => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(minorUnits) || 0) / 100);
const percent = (part, whole) => `${whole ? Math.round((100 * part) / whole) : 0}%`;
// The billing block counts subscriptions per kind and revenue per currency; a plain number is accepted too.
const total = value => value && typeof value === "object" ? Object.values(value).reduce((sum, item) => sum + (Number(item) || 0), 0) : Number(value) || 0;
const usd = value => value && typeof value === "object" ? value.usd ?? value.USD ?? 0 : value;

// Admin pages stay out of search results while they are open.
function useNoindex() {
  useEffect(() => {
    let node = document.head.querySelector('meta[name="robots"]');
    const created = !node, previous = node?.getAttribute("content");
    if (!node) { node = document.createElement("meta"); node.setAttribute("name", "robots"); document.head.appendChild(node); }
    node.setAttribute("content", "noindex, nofollow");
    return () => { if (created) node.remove(); else if (previous == null) node.removeAttribute("content"); else node.setAttribute("content", previous); };
  }, []);
}

// A plain request with a retry; nothing here is cached, so an admin's numbers never outlive the page.
function useAdminLoad(load, key, enabled) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ token: null, data: null, error: null });
  const token = `${key}:${attempt}`;
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    load().then(data => { if (active) setState({ token, data, error: null }); }, error => { if (active) setState({ token, data: null, error }); });
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, enabled]);
  const done = state.token === token;
  return { data: done ? state.data : null, error: done ? state.error : null, retry: () => setAttempt(value => value + 1) };
}

function Failed({ retry }) {
  return <div className="bv-notice bv-notice--error"><p role="alert">We couldn’t load this just now.</p><Button variant="secondary" onClick={retry}>Try again</Button></div>;
}

function Waiting() {
  return <div className="bv-admin-waiting" aria-busy="true"><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line bv-skeleton--short" /></div>;
}

function Tiles({ items }) {
  return <dl className="bv-admin-tiles">{items.map(([label, value]) => <div key={label} className="bv-admin-tile"><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function Section({ id, title, children }) {
  return <section className="bv-admin-section" aria-labelledby={`bv-admin-${id}`}><h2 id={`bv-admin-${id}`}>{title}</h2>{children}</section>;
}

// The catalogue health block is shown as the API sends it: its own names, one row per value.
function flatten(value, prefix = "") {
  if (Array.isArray(value)) return [[prefix, value.length ? value.join("; ") : "0"]];
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) => flatten(item, prefix ? `${prefix}.${key}` : key));
  return [[prefix, value == null ? "0" : String(value)]];
}

function Overview({ load }) {
  if (load.error) return <Failed retry={load.retry} />;
  if (!load.data) return <Waiting />;
  const { readers, clubs, subscriptions } = load.data;
  return <Tiles items={[["Readers", number(readers?.total)], ["New this week", number(readers?.new_7d)], ["New this month", number(readers?.new_30d)], ["Active this week", number(readers?.weekly_active)],
    ["Clubs", number(clubs?.total)], ["Active clubs (30 days)", number(clubs?.active_30d)], ["Books on loan", number(load.data.open_loans)], ["Imports (30 days)", number(load.data.imports_completed_30d)],
    ["Paying subscriptions", number(total(subscriptions?.active))], ["Monthly revenue", dollars(usd(subscriptions?.mrr_minor_units))]]} />;
}

function Metrics({ load }) {
  if (load.error) return <Failed retry={load.retry} />;
  if (!load.data) return <Waiting />;
  const data = load.data, totals = data.totals || {}, byRef = new Map((data.channels?.totals || []).map(row => [row.ref || "", row]));
  const known = new Set(SOURCES.map(([ref]) => ref));
  const direct = [...byRef].filter(([ref]) => !known.has(ref)).reduce((sum, [, row]) => [sum[0] + row.visits, sum[1] + row.signups], [0, 0]);
  const rows = [...SOURCES.map(([ref, label]) => [label, byRef.get(ref)?.visits || 0, byRef.get(ref)?.signups || 0]), ["Direct", ...direct]];
  const first = data.new_accounts_with_3_saves_in_7_days, accounts = data.new_accounts;
  const importsStarted = (data.imports || []).reduce((sum, day) => sum + (day.started || 0), 0), billing = data.billing || {};
  return <>
    <Section id="readers" title="Readers"><Tiles items={[["New accounts", number(accounts)], ["Active in first week", number(first)], ["Activation rate", percent(first, accounts)]]} /></Section>
    <Section id="sources" title="Where readers come from"><div className="bv-admin-scroll"><table className="bv-admin-table"><thead><tr><th scope="col">Source</th><th scope="col">Visits</th><th scope="col">Sign-ups</th></tr></thead>
      <tbody>{rows.map(([label, visits, signups]) => <tr key={label}><th scope="row">{label}</th><td>{number(visits)}</td><td>{number(signups)}</td></tr>)}</tbody></table></div></Section>
    <Section id="scanning" title="Scanning"><Tiles items={[["Scans opened", number(data.scans?.opened ?? totals.scan_opened)], ["Books added by scan", number(data.scans?.added ?? totals.scan_added)],
      ...SCAN_ROWS.map(([name, label]) => [label, number(totals[name])])]} /></Section>
    <Section id="imports" title="Imports"><Tiles items={[["Imports started", number(importsStarted)], ["Books imported", number(data.catalogue?.imports?.rows)]]} /></Section>
    <Section id="catalogue" title="Catalogue"><div className="bv-admin-scroll"><table className="bv-admin-table bv-admin-table--plain"><tbody>
      {flatten(data.catalogue || {}).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{value}</td></tr>)}</tbody></table></div></Section>
    <Section id="money" title="Money"><Tiles items={[["Patrons", number(billing.active_subscriptions?.patron)], ["Club Plus clubs", number(billing.active_subscriptions?.club_plus)], ["Monthly revenue", dollars(usd(billing.mrr_minor_units))]]} /></Section>
  </>;
}

export default function AdminPage({ notFound }) {
  useNoindex();
  const auth = useAuth();
  const [days, setDays] = useState(30);
  const signedIn = !auth.isLoading && auth.isAuthenticated;
  const overview = useAdminLoad(getAdminOverview, "overview", signedIn);
  const metrics = useAdminLoad(() => getAdminMetrics(days), `metrics:${days}`, signedIn && Boolean(overview.data));
  const denied = !auth.isLoading && (!auth.isAuthenticated || [401, 403, 404].includes(overview.error?.status));
  useEffect(() => { if (denied) document.title = "Page not found · Bookvane"; }, [denied]);
  if (denied) return notFound;
  return <section className="bv-container bv-admin"><h1>Admin</h1>
    <Section id="overview" title="Overview"><Overview load={overview} /></Section>
    <div className="bv-admin-period" role="group">{PERIODS.map(value => <button key={value} type="button" className="bv-pill" aria-pressed={days === value} onClick={() => setDays(value)}>{value} days</button>)}</div>
    {overview.data ? <Metrics load={metrics} /> : overview.error ? null : <Waiting />}
  </section>;
}
