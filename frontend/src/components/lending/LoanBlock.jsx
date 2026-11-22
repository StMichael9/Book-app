import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Ellipsis } from "lucide-react";
import { deleteLoan, listLoans, revokeLoanShare, updateLoan } from "../../api/loans.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { errorText } from "../ui-v2/data.js";
import { LoanSheet } from "./LoanSheets.jsx";
import { useLoanShare } from "./loanShare.jsx";
import { readShelfAfterLoan } from "./loanShelf.js";
import { orderLoans, pastLine, sinceLine, who } from "./loanText.js";
import "../../styles/ui-v2/lending.css";

// The loans of one entry: the open ones and the last five closed. `entryId` is null for a book not on the shelf.
function useLoans(entryId) {
  const [state, setState] = useState({ entryId: null, open: [], past: [] }), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!entryId) return undefined;
    let active = true;
    Promise.all([listLoans({ entry_id: entryId, state: "open" }), listLoans({ entry_id: entryId, state: "closed", limit: 5 })])
      .then(([open, past]) => { if (active) setState({ entryId, open: open.items || [], past: past.items || [] }); }, () => {});
    return () => { active = false; };
  }, [entryId, attempt]);
  const current = state.entryId === entryId;
  return { open: current ? state.open : [], past: current ? state.past : [], ready: !entryId || current, reload: useCallback(() => setAttempt(value => value + 1), []) };
}

// Typos and mistakes are fixed here: Edit changes the name or date, Delete removes the loan.
function CorrectionMenu({ loan, onEdit, onDelete }) {
  const [open, setOpen] = useState(false), root = useRef(null), button = useRef(null), id = useId();
  useEffect(() => {
    if (!open) return undefined;
    root.current?.querySelector('[role="menuitem"]')?.focus();
    const away = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const label = `More actions for ${who(loan)}`;
  const pick = action => { setOpen(false); action(); };
  return <div className={`bv-more bv-loan-more${open ? " is-open" : ""}`} ref={root}
    onKeyDown={event => { if (open && event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); } }}
    onBlur={event => { if (open && event.relatedTarget && !root.current?.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={button} type="button" className="bv-more-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <span className="bv-more-dot"><Ellipsis aria-hidden="true" /></span>
    </button>
    {open && <div id={id} className="bv-more-menu" role="menu" aria-label={label}>
      <button type="button" role="menuitem" className="bv-more-item" onClick={() => pick(onEdit)}>Edit</button>
      <button type="button" role="menuitem" className="bv-more-item" onClick={() => pick(onDelete)}>Delete</button>
    </div>}
  </div>;
}

function LoanCard({ loan, busy, onReturn, onShare, onStop, onEdit, onDelete }) {
  const lent = loan.direction === "lent", back = lent && loan.said_back, overdue = loan.overdue && !back;
  return <section className={`bv-loan-card${back ? " is-back" : ""}`} aria-label={who(loan)}>
    <div className="bv-loan-head">
      <p className="bv-loan-name">{back ? `${loan.person_name} says it’s back` : who(loan)}{overdue && <span className="bv-loan-chip">Overdue</span>}</p>
      <CorrectionMenu loan={loan} onEdit={onEdit} onDelete={onDelete} />
    </div>
    <p className="bv-muted bv-loan-line">{sinceLine(loan)}</p>
    <div className="bv-loan-actions">
      <Button disabled={busy} onClick={onReturn}>{lent ? "Returned" : "Given back"}</Button>
      {lent && !back && <Button variant="secondary" disabled={busy} onClick={() => onShare(loan, overdue ? "remind" : "send")}>{overdue ? `Remind ${loan.person_name}` : `Send ${loan.person_name} a link`}</Button>}
    </div>
    {lent && loan.has_link && !back && <button type="button" className="bv-loan-stop" disabled={busy} onClick={onStop}>Stop sharing</button>}
  </section>;
}

// Lend, borrow, return and share, on one entry. `book` is { title, cover_image_url, authors }; `isOwned` gates Lend.
export default function LoanBlock({ entryId, bookId, book, isOwned }) {
  const library = useUserBooks();
  const loans = useLoans(entryId);
  const [sheet, setSheet] = useState(null), [confirming, setConfirming] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { reload } = loans;
  async function run(action) {
    setBusy(true); setError("");
    try { await action(); } catch (failure) { setError(errorText(failure, "Please try again.")); } finally { setBusy(false); }
  }
  // A loan made on a book that isn't on the shelf yet adds it, so the shelf state is read again.
  const saved = useCallback(async created => {
    if (!entryId && created?.entry_id) await readShelfAfterLoan(library, bookId);
    reload();
  }, [entryId, bookId, library, reload]);
  const sharing = useLoanShare();
  const share = (loan, kind) => run(async () => { await sharing.share(loan, kind, book.title); reload(); });
  if (!library.readingActions || library.readOnly || !loans.ready) return null;
  const open = orderLoans(loans.open);
  return <section className="bv-loan-block" aria-label="Lending">
    {open.length === 0 && <div className="bv-loan-pills">{isOwned && entryId && <Button variant="secondary" onClick={() => setSheet({ mode: "lent" })}>Lend this book</Button>}<Button variant="secondary" onClick={() => setSheet({ mode: "borrowed" })}>I borrowed this</Button></div>}
    {open.map(loan => <LoanCard key={loan.id} loan={loan} busy={busy}
      onReturn={() => run(async () => { await updateLoan(loan.id, { ended: true }); reload(); })}
      onShare={share} onStop={() => run(async () => { await revokeLoanShare(loan.id); reload(); })}
      onEdit={() => setSheet({ mode: loan.direction, loan })} onDelete={() => setConfirming(loan)} />)}
    {error && <p role="alert" className="bv-field-error">{error}</p>}
    {loans.past.length > 0 && <div className="bv-loan-past"><h3>Past loans</h3><ul>{loans.past.map(loan => <li key={loan.id} className="bv-muted">{pastLine(loan)}</li>)}</ul></div>}
    {sheet && <LoanSheet key={sheet.loan?.id || sheet.mode} mode={sheet.mode} loan={sheet.loan} book={book} entryId={entryId} bookId={bookId} onClose={() => setSheet(null)} onSaved={saved} onShare={share} />}
    {confirming && <NativeDialog open onClose={() => setConfirming(null)} title="Delete this loan?" className="bv-lend-sheet">
      <p>This can’t be undone.</p>
      <div className="bv-dialog-actions bv-loan-foot"><Button variant="secondary" onClick={() => setConfirming(null)}>Cancel</Button>
        <Button variant="danger" onClick={() => { const loan = confirming; setConfirming(null); run(async () => { await deleteLoan(loan.id); reload(); }); }}>Delete</Button></div>
    </NativeDialog>}
    {sharing.sheet}
  </section>;
}
