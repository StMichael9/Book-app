import { GOOGLE_CREDIT } from "./descriptionCredit.js";

const httpsLink = value => { try { return new URL(value).protocol === "https:" ? value : null; } catch { return null; } };

// Google's text is shown whole and unaltered (plain text, never HTML) with a link back to its page.
export function GoogleCredit({ link }) {
  const href = httpsLink(link);
  return <p className="bv-description-credit">{href
    ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${GOOGLE_CREDIT} (opens in a new tab)`}>{GOOGLE_CREDIT}</a>
    : GOOGLE_CREDIT}</p>;
}

export default function DescriptionBody({ text, link }) {
  return <><p className="bv-description-full">{text}</p><GoogleCredit link={link} /></>;
}
