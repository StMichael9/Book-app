import { ExternalLink } from "lucide-react";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import "../../styles/ui-v2/book-page.css";
import { trackEvent } from "./events.js";

// "Get a copy": Bookshop.org as an outline pill, only when its id is set, with the commission
// disclosure under it. With no id set nothing shows. `heading={false}` is the links-only form used on the reading page.
export default function GetACopyBlock({ book, heading = true }) {
  const url = bookshopAffiliateUrl(book);
  if (!url) return null;
  return <div className="bv-copy-block">
    {heading && <h2>Get a copy</h2>}
    <div className="bv-copy-links"><a className="bv-copy-link bv-copy-link--pill" href={url} target="_blank" rel="sponsored noopener"
      onClick={() => trackEvent("get_copy_click", { placement: "bookshop" })}><span>Bookshop.org</span><ExternalLink aria-hidden="true" /><span className="bv-sr-only"> (opens in a new tab)</span></a></div>
    <p className="bv-copy-note">We may earn a small commission at no cost to you.</p>
  </div>;
}
