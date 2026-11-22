import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useReader } from "../readerState.js";
import { ActionLink, TextLink } from "../primitives.jsx";
import { COPY, LIVE, faqItems, paidItems } from "./landingCopy.js";

const SIZES = { phone: [390, 844], desktop: [1440, 900] };

// A real capture of the running app, one file per theme. The reader's own theme choice picks the file; only that one is requested.
function Still({ name, kind, alt, eager = false }) {
  const theme = useReader().theme === "dark" ? "dark" : "light";
  const [width, height] = SIZES[kind];
  return <img className={`bv-landing-still bv-landing-still--${kind}`} src={`/landing/${name}-${theme}.webp`} width={width} height={height} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchpriority: "high" } : {})} />;
}

function Phone({ children }) { return <div className="bv-landing-phone">{children}</div>; }
function Browser({ children }) { return <div className="bv-landing-browser"><div className="bv-landing-browser-bar" aria-hidden="true"><i /><i /><i /></div>{children}</div>; }

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(max-width: 700px)").matches);
  useEffect(() => {
    const query = window.matchMedia?.("(max-width: 700px)");
    if (!query) return undefined;
    const update = () => setNarrow(query.matches);
    update(); query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

function setMeta(attribute, key, content) {
  let node = document.head.querySelector(`meta[${attribute}="${key}"]`);
  const created = !node;
  if (!node) { node = document.createElement("meta"); node.setAttribute(attribute, key); document.head.appendChild(node); }
  const previous = node.getAttribute("content");
  node.setAttribute("content", content);
  return () => { if (created) node.remove(); else if (previous == null) node.removeAttribute("content"); else node.setAttribute("content", previous); };
}

// The document describes the landing page while it is open; the FAQPage data lists exactly the answers that are shown.
function useLandingSeo(faq) {
  const key = JSON.stringify(faq.map(item => [item.q, item.a]));
  useEffect(() => {
    const previousTitle = document.title;
    document.title = COPY.title;
    const undo = [setMeta("name", "description", COPY.description), setMeta("property", "og:title", COPY.title), setMeta("property", "og:description", COPY.description)];
    let canonical = document.head.querySelector('link[rel="canonical"]'); const madeCanonical = !canonical, oldHref = canonical?.getAttribute("href");
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = "https://bookvane.me/";
    const script = document.createElement("script");
    script.type = "application/ld+json"; script.id = "bv-landing-faq";
    script.textContent = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: JSON.parse(key).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) });
    document.head.appendChild(script);
    return () => { document.title = previousTitle; undo.forEach(restore => restore()); script.remove(); if (madeCanonical) canonical.remove(); else canonical.setAttribute("href", oldHref); };
  }, [key]);
}

export default function LandingPage({ live = LIVE }) {
  const auth = useAuth(), narrow = useNarrow();
  const faq = faqItems(live), paid = paidItems(live);
  useLandingSeo(faq);
  const signup = returnTo => `/register?${new URLSearchParams({ src: "landing", ...(returnTo ? { returnTo } : {}) })}`;
  const importTarget = auth.isAuthenticated ? "/my-books/import" : live.switchPage ? "/switch" : signup("/my-books/import");
  const scanTarget = auth.isAuthenticated ? "/my-books" : narrow ? signup("/my-books") : signup();
  const create = signup();
  const doors = () => auth.isAuthenticated
    ? <div className="bv-landing-doors"><ActionLink to="/browse">{COPY.signedIn.explore}</ActionLink><TextLink to="/my-books">{COPY.signedIn.library}</TextLink></div>
    : <div className="bv-landing-doors"><ActionLink to={create}>{COPY.hero.create}</ActionLink><TextLink to="/browse" state={{ focusSearch: true }}>{COPY.hero.browse}</TextLink></div>;
  return <>
    <section className="bv-container bv-landing-hero" aria-label="Welcome">
      <div className="bv-landing-copy">
        <h1>{COPY.hero.heading}</h1>
        <p className="bv-landing-lead">{COPY.hero.line}</p>
        {doors()}
        <p className="bv-landing-free">{auth.isAuthenticated ? "Your books are right where you left them." : COPY.hero.quiet}</p>
      </div>
      <Phone><Still name="scan-hero" kind="phone" alt={COPY.alt.scan} eager /></Phone>
    </section>

    <section className="bv-container bv-landing-block" aria-labelledby="bv-landing-scan">
      <div className="bv-landing-text"><h2 id="bv-landing-scan">{COPY.scan.heading}</h2><p>{COPY.scan.line}</p><p className="bv-landing-small">{COPY.scan.small}</p><ActionLink to={scanTarget}>{COPY.scan.cta}</ActionLink></div>
      <div className="bv-landing-row" role="group" aria-label="Scanning, step by step">
        {[["scan-aim", COPY.alt.aim], ["scan-tick", COPY.alt.tick], ["scan-add", COPY.alt.add]].map(([name, alt]) => <Phone key={name}><Still name={name} kind="phone" alt={alt} /></Phone>)}
      </div>
    </section>

    <section className="bv-container bv-landing-block bv-landing-block--flip" aria-labelledby="bv-landing-library">
      <div className="bv-landing-text"><h2 id="bv-landing-library">{COPY.library.heading}</h2><p>{COPY.library.line}</p><ActionLink to={importTarget}>{COPY.library.cta}</ActionLink></div>
      <Browser><Still name="import" kind="desktop" alt={COPY.alt.library} /></Browser>
    </section>

    <section className="bv-container bv-landing-block" aria-labelledby="bv-landing-private">
      <div className="bv-landing-text"><h2 id="bv-landing-private">{COPY.priv.heading}</h2><p>{COPY.priv.line}</p><p>{COPY.priv.ai}</p><TextLink to="/privacy">{COPY.priv.link}</TextLink></div>
      <div className="bv-landing-row bv-landing-row--two"><Phone><Still name="private-note" kind="phone" alt={COPY.alt.note} /></Phone><Phone><Still name="private-thumbs" kind="phone" alt={COPY.alt.thumbs} /></Phone></div>
    </section>

    <section className="bv-container bv-landing-block bv-landing-block--flip" aria-labelledby="bv-landing-track">
      <div className="bv-landing-text"><h2 id="bv-landing-track">{COPY.track.heading}</h2><p>{COPY.track.line}</p></div>
      <Browser><Still name="track" kind="desktop" alt={COPY.alt.track} /></Browser>
    </section>

    <section className="bv-container bv-landing-paid" aria-labelledby="bv-landing-paid">
      <h2 id="bv-landing-paid">{COPY.paid.heading}</h2><p className="bv-landing-paid-line">{COPY.paid.line}</p>
      <ul className="bv-landing-promises">{paid.map(item => <li key={item.key}><b>{item.title}</b><span>{item.text}</span></li>)}</ul>
      <TextLink to="/privacy">{COPY.paid.link}</TextLink>
    </section>

    <section className="bv-container bv-landing-faq" aria-labelledby="bv-landing-faq">
      <h2 id="bv-landing-faq">{COPY.faqHeading}</h2>
      <div className="bv-landing-faq-list">{faq.map(item => <details key={item.q}><summary><span>{item.q}</span><ChevronDown size={18} strokeWidth={2} aria-hidden="true" /></summary><p>{item.a}{item.link && <> <Link className="bv-text-link" to="/privacy">Privacy page</Link></>}</p></details>)}</div>
    </section>

    <section className="bv-container bv-landing-final" aria-labelledby="bv-landing-final">
      <h2 id="bv-landing-final">{COPY.final.heading}</h2><p>{COPY.final.line}</p>{doors()}
    </section>
  </>;
}
