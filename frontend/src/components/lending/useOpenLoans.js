import { useCallback, useEffect, useState } from "react";
import { listLoans } from "../../api/loans.js";

// Overdue first, then lent, then borrowed; the server's own order (due date) holds inside each group.
const rank = loan => (loan.overdue ? 0 : loan.direction === "lent" ? 1 : 2);
export const sortOnLoan = loans => [...loans].sort((a, b) => rank(a) - rank(b));

// All of the reader's open loans, in one request (a reader's loans are few). Nothing is asked when `enabled` is false.
export function useOpenLoans(enabled, sessionKey = "") {
  const [state, setState] = useState({ key: null, loans: [] }), [attempt, setAttempt] = useState(0);
  const key = `${sessionKey}:${attempt}`;
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    listLoans({ state: "open" }).then(result => { if (active) setState({ key, loans: result.items || [] }); }, () => {});
    return () => { active = false; };
  }, [enabled, key]);
  const ready = enabled && state.key === key;
  return { loans: ready ? sortOnLoan(state.loans) : [], ready, reload: useCallback(() => setAttempt(value => value + 1), []) };
}
