import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useReader } from "../readerState.js";
import { ActionLink, TextLink } from "../primitives.jsx";
import { COPY, LIVE, faqItems, paidText } from "./landingCopy.js";

const SIZES = { "scan-hero": [390, 560], "import-review": [390, 544], "private-notes": [390, 589] };

// A real capture of the running app, one file per theme and density. The reader's own theme choice picks the files; WebP first, PNG as the fallback.
function Shot({ name, alt, eager = false }) {
  const theme = useReader().theme === "dark" ? "dark" : "light";
  const [width, height] = SIZES[name], base = `/landing/${name}-${theme}`;
  return <picture className="bv-landing-shot">
    <source type="image/webp" srcSet={`${base}@1x.webp 1x, ${base}@2x.webp 2x`} />
    <img src={`${base}@2x.png`} width={width} height={height} alt={alt} loading={eager ? "eager" : "lazy"} decoding="async" {...(eager ? { fetchpriority: "high" } : {})} />
  </picture>;
}

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
  const faq = faqItems(live);
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
        {auth.isAuthenticated && <p className="bv-landing-free">{COPY.signedIn.line}</p>}
      </div>
      <Shot name="scan-hero" alt={COPY.alt.scan} eager />
    </section>

    <section className="bv-container bv-landing-block bv-landing-block--text" aria-labelledby="bv-landing-scan">
      <div className="bv-landing-text"><h2 id="bv-landing-scan">{COPY.scan.heading}</h2><p>{COPY.scan.line}</p><p className="bv-landing-small">{COPY.scan.small}</p><ActionLink to={scanTarget}>{COPY.scan.cta}</ActionLink></div>
    </section>

    <section className="bv-container bv-landing-block bv-landing-block--flip" aria-labelledby="bv-landing-library">
      <div className="bv-landing-text"><h2 id="bv-landing-library">{COPY.library.heading}</h2><p>{COPY.library.line}</p><ActionLink to={importTarget}>{COPY.library.cta}</ActionLink></div>
      <Shot name="import-review" alt={COPY.alt.library} />
    </section>

    <section className="bv-container bv-landing-block" aria-labelledby="bv-landing-private">
      <div className="bv-landing-text"><h2 id="bv-landing-private">{COPY.priv.heading}</h2><p>{COPY.priv.line}</p><p>{COPY.priv.ai}</p><TextLink to="/privacy">{COPY.priv.link}</TextLink></div>
      <Shot name="private-notes" alt={COPY.alt.note} />
    </section>

    <section className="bv-container bv-landing-paid" aria-labelledby="bv-landing-paid">
      <h2 id="bv-landing-paid">{COPY.paid.heading}</h2><p className="bv-landing-paid-line">{paidText(live)}</p>
      <TextLink to="/privacy">{COPY.paid.link}</TextLink>
    </section>

    <section className="bv-container bv-landing-faq" aria-labelledby="bv-landing-faq">
      <h2 id="bv-landing-faq">{COPY.faqHeading}</h2>
      <div className="bv-landing-faq-list">{faq.map(item => <details key={item.q}><summary><span>{item.q}</span><ChevronDown size={18} strokeWidth={2} aria-hidden="true" /></summary><p>{item.a}{item.link && <> <Link className="bv-text-link" to="/privacy">Privacy page</Link></>}</p></details>)}</div>
    </section>

    <section className="bv-container bv-landing-final" aria-labelledby="bv-landing-final">
      <h2 id="bv-landing-final">{COPY.final.heading}</h2>{doors()}
    </section>
  </>;
}
