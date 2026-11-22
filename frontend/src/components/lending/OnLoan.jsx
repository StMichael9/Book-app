import { useState } from "react";
import { Link } from "react-router-dom";
import { updateLoan } from "../../api/loans.js";
import { BookCover, Button } from "../ui-v2/primitives.jsx";
import { errorText } from "../ui-v2/data.js";
import { useLoanShare } from "./loanShare.jsx";
import { day, who } from "./loanText.js";
import "../../styles/ui-v2/lending.css";

const dueLine = loan => `${who(loan)}${loan.due_on ? ` · ${loan.direction === "lent" ? "due back" : "give back by"} ${day(loan.due_on)}` : ""}`;
const bookOf = loan => ({ title: loan.title, cover_image_url: loan.cover_image_url ?? null, authors: (loan.authors || []).map(name => ({ name })) });

// A loan as a row: a 56px cover (a private book has none, so the jacket shows), the title, who and when, and Overdue.
// Only an overdue loan carries an action here; the rest happens in the book's own loan block.
function Row({ loan, onChanged, onError, sharing }) {
  const [busy, setBusy] = useState(false);
  async function act() {
    setBusy(true);
    try {
      if (loan.direction === "lent") await sharing.share(loan, "remind", loan.title); else await updateLoan(loan.id, { ended: true });
      onChanged();
    } catch (failure) { onError(errorText(failure, "Please try again.")); } finally { setBusy(false); }
  }
  return <li className="bv-onloan-row">
    <div className="bv-onloan-cover"><BookCover book={bookOf(loan)} size="small" decorative /></div>
    <div>
      <p className="bv-onloan-title"><Link to={`/my-books/${loan.entry_id}`}>{loan.title}</Link></p>
      <p className="bv-muted">{dueLine(loan)}{loan.overdue && <span className="bv-loan-chip">Overdue</span>}</p>
      {loan.overdue && <Button variant="quiet" className="bv-inline-action" disabled={busy} onClick={act}>{loan.direction === "lent" ? `Remind ${loan.person_name}` : "Given back"}</Button>}
    </div>
  </li>;
}

function List({ loans, onChanged, label }) {
  const sharing = useLoanShare(), [error, setError] = useState("");
  return <>
    <ul aria-label={label}>{loans.map(loan => <Row key={loan.id} loan={loan} sharing={sharing} onChanged={() => { setError(""); onChanged(); }} onError={setError} />)}</ul>
    {error && <p role="alert" className="bv-field-error">{error}</p>}
    {sharing.sheet}
  </>;
}

// Home: only when something is overdue, and only the overdue loans.
export function OnLoanHome({ loans, onChanged }) {
  const overdue = loans.filter(loan => loan.overdue);
  if (!overdue.length) return null;
  return <section className="bv-onloan" aria-labelledby="bv-onloan-title"><h2 id="bv-onloan-title">On loan</h2><List loans={overdue} onChanged={onChanged} label="Overdue loans" /></section>;
}

// My Books: every open loan, in place of the paged list.
export function OnLoanView({ loans, ready, onChanged }) {
  return <section className="bv-onloan bv-onloan--view" aria-label="On loan">{!ready ? null : <List loans={loans} onChanged={onChanged} label="On loan" />}</section>;
}
