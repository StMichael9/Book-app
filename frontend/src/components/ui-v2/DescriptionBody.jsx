import ClampedText from "./ClampedText.jsx";
import { GOOGLE_CREDIT } from "./descriptionCredit.js";

const httpsLink = value => { try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; } };

// Google's text is shown whole and unaltered (plain text, never HTML) with a link back to its page.
export function GoogleCredit({ link }) {
  const href = httpsLink(link);
  return <p className="bv-description-credit">{href
    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${GOOGLE_CREDIT} (opens in a new tab)`}>{GOOGLE_CREDIT}</a>
    : GOOGLE_CREDIT}</p>;
}

// With `lines`, the text starts clamped behind "Show more"; the credit always stays visible under it.
export default function DescriptionBody({ text, link, lines }) {
  return <>{lines ? <ClampedText text={text} lines={lines} className="bv-description-full" /> : <p className="bv-description-full">{text}</p>}<GoogleCredit link={link} /></>;
}
