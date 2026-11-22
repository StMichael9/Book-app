import { useState } from "react";
import { shareLoan } from "../../api/loans.js";
import { MessageSheet } from "./LoanSheets.jsx";
import { remindMessage, sendMessage } from "./loanText.js";

// Send a link or a reminder: the link is made (or reused), then the message goes through Web Share, or is shown to copy.
export function useLoanShare() {
  const [message, setMessage] = useState(null);
  async function share(loan, kind, title) {
    const { url } = await shareLoan(loan.id);
    const text = kind === "remind" ? remindMessage(loan.person_name, title, url) : sendMessage(loan.person_name, url);
    if (navigator.share) { try { await navigator.share({ text }); } catch (failure) { if (failure?.name !== "AbortError") setMessage({ kind, loan, text }); } }
    else setMessage({ kind, loan, text });
  }
  const sheet = message && <MessageSheet title={message.kind === "remind" ? `Remind ${message.loan.person_name}` : `Send ${message.loan.person_name} a link`} text={message.text} onClose={() => setMessage(null)} />;
  return { share, sheet };
}
