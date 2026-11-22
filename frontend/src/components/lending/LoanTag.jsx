import { who } from "./loanText.js";
import "../../styles/ui-v2/lending.css";

// "Lent to Sam" / "Borrowed from Ana" on a card or row, with the Overdue chip when it applies.
export default function LoanTag({ loan, inline = false }) {
  if (!loan) return null;
  const Tag = inline ? "span" : "p";
  return <Tag className={`bv-loan-tag${inline ? " bv-loan-tag--inline" : ""}`}>{who(loan)}{loan.overdue && !loan.said_back && <span className="bv-loan-chip">Overdue</span>}</Tag>;
}
