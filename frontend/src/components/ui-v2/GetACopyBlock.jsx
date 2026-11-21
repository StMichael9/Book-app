import { ExternalLink } from "lucide-react";
import { amazonAffiliateUrl, bookshopAffiliateUrl } from "../../api/affiliate.js";
import "../../styles/ui-v2/book-page.css";
import { trackEvent } from "./events.js";

// "Get a copy": Bookshop.org as an outline pill and Amazon as a quieter text link, each only when its id is set, with the commission
// disclosure under them. With neither id set nothing shows. `heading={false}` is the links-only form used on the reading page.
export default function GetACopyBlock({ book, heading = true }) {
  const shops = [["bookshop", "Bookshop.org", bookshopAffiliateUrl(book)], ["amazon", "Amazon", amazonAffiliateUrl(book)]].filter(([, , url]) => url);
  if (!shops.length) return null;
  return <div className="bv-copy-block">
    {heading && <h2>Get a copy</h2>}
    <div className="bv-copy-links">{shops.map(([shop, label, url]) => <a key={shop} className={`bv-copy-link bv-copy-link--${shop === "bookshop" ? "pill" : "text"}`} href={url} target="_blank" rel="sponsored noopener"
      onClick={() => trackEvent("get_copy_click", { placement: shop })}><span>{label}</span><ExternalLink aria-hidden="true" /><span className="bv-sr-only"> (opens in a new tab)</span></a>)}</div>
    <p className="bv-copy-note">We may earn a small commission at no cost to you.</p>
  </div>;
}
