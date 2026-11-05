import { useState } from "react";
import { coverFallback, coverSrc } from "../../api/coverUrl.js";
import { bookCloth } from "./shelfData.js";

// One cover in a 2:3 frame. A book with no artwork, or artwork that fails, is a bookcloth spine block, never a letter tile.
// The spine shows behind a loading cover only after a beat, like the typographic jacket, and never for a cover the browser holds.
function Slot({ url, cloth }) {
  const [state, setState] = useState({ url, status: "loading", step: 0 });
  const current = state.url === url ? state : { status: "loading", step: 0 };
  // Step 0 is the image cache, step 1 Open Library directly, then no artwork could be had.
  const { status, step } = current;
  const src = url && step < 2 ? (step === 0 ? coverSrc(url) : coverFallback(url)) : null;
  const settle = value => setState({ url, status: value, step });
  const fail = () => setState({ url, status: "loading", step: step === 0 && coverFallback(url) ? 1 : 2 });
  return <span className={`bv-art-slot${src && status === "loaded" ? " is-loaded" : ""}`}>
    {(!src || status !== "loaded") && <span className={`bv-art-spine${src && status === "loading" ? " is-waiting" : ""}`} style={{ background: cloth }} />}
    {src && <img key={src} src={src} alt="" loading="lazy" decoding="async"
      ref={node => { if (node?.complete && node.naturalWidth > 0 && status === "loading") settle("loaded"); }}
      onLoad={() => settle("loaded")} onError={fail} />}
  </span>;
}

// A coverless book on a list row: its bookcloth spine, never a blank tile.
export function SpineBlock({ bookId }) {
  return <span className="bv-art-slot"><span className="bv-art-spine" style={{ background: bookCloth(bookId) }} /></span>;
}

// `items` are { key, url } with the book id as the key: up to four are shown side by side. An empty list shows one
// outlined spine on a short baseline.
export default function ListArt({ items, tall = false, compact = false }) {
  const shown = items.slice(0, compact ? 3 : 4), size = `${tall ? " bv-art--tall" : ""}${compact ? " bv-art--compact" : ""}`;
  if (!shown.length) return <span className={`bv-art bv-art--empty${size}`} aria-hidden="true"><i /></span>;
  return <span className={`bv-art${size}`} aria-hidden="true">
    {shown.map(item => <Slot key={item.key} url={item.url} cloth={bookCloth(item.key)} />)}</span>;
}
