import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicLoan, loanGivenBack } from "../../api/loans.js";
import { BookCover, Button, TextLink } from "../ui-v2/primitives.jsx";
import { day } from "./loanText.js";
import "../../styles/ui-v2/lending.css";

// /l/:token: what a borrower sees from a lender's link. Public, no account, never indexed. The page holds the one book, the
// lender's first name and the dates; the server never sends the borrower's own name.
export default function BorrowerPage({ notFound }) {
  const { token } = useParams();
  const [state, setState] = useState({ token: null, loan: null, missing: false }), [thanked, setThanked] = useState(false);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  useEffect(() => {
    let active = true;
    getPublicLoan(token).then(loan => { if (active) setState({ token, loan, missing: false }); }, error => { if (active) setState({ token, loan: null, missing: error?.status === 404 }); });
    return () => { active = false; };
  }, [token]);
  const current = state.token === token;
  if (current && state.missing) return notFound;
  if (!current) return <section className="bv-container bv-borrower" aria-busy="true"><p role="status" className="bv-sr-only">Opening</p></section>;
  const loan = state.loan;
  if (!loan) return <section className="bv-container bv-borrower"><p role="alert">Please try again.</p></section>;
  const lender = loan.lender_first_name || "A reader", closed = loan.state === "closed", said = thanked || loan.said_back;
  async function back() {
    setPending(true); setFailed(false);
    try { await loanGivenBack(token); setThanked(true); } catch { setFailed(true); } finally { setPending(false); }
  }
  return <section className="bv-container bv-borrower" aria-labelledby="bv-borrower-title">
    <div className="bv-borrower-cover"><BookCover book={{ title: loan.title, cover_image_url: loan.cover_url, authors: (loan.authors || []).map(name => ({ name })) }} size="large" priority /></div>
    <h1 id="bv-borrower-title">{loan.title || "Untitled book"}</h1>
    {loan.authors?.length > 0 && <p className="bv-muted">{loan.authors.join(", ")}</p>}
    {closed ? <p>This loan is closed.</p> : <>
      <p>{lender} lent you this on {day(loan.started_on)}.</p>
      {loan.due_on && <p>Due back {day(loan.due_on)}.</p>}
      {said ? <p role="status">Thanks! {lender} will see that it’s back.</p>
        : <Button disabled={pending} onClick={back}>I’ve given it back</Button>}
      {failed && <p role="alert" className="bv-field-error">Please try again.</p>}
    </>}
    <div className="bv-borrower-foot"><p>Keep track of your own books.</p><TextLink to="/register?ref=loan">Start your own shelf</TextLink></div>
  </section>;
}
