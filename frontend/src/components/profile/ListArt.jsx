import { useState } from "react";
import { coverFallback, coverSrc } from "../../api/coverUrl.js";
import { clothFor } from "./shelfData.js";

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

// `items` are { key, url }: up to four are shown side by side.
export default function ListArt({ items, tall = false }) {
  const shown = items.slice(0, 4);
  return <span className={`bv-art${tall ? " bv-art--tall" : ""}`} aria-hidden="true">
    {shown.length ? shown.map(item => <Slot key={item.key} url={item.url} cloth={clothFor("book", item.key)} />) : <Slot url={null} cloth="var(--bv-wash)" />}</span>;
}
