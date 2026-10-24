import { useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./AuthContext.jsx";
import { errorText } from "../components/ui-v2/data.js";

// A departed account must never publish a result, download, error or navigation
// into the next account. Command identifiers and drafts remain page-local.
export function useReadingCommand(fallback = "Your reading couldn’t be updated. Please try again.", { conflictMessage } = {}) {
  const auth = useAuth();
  const session = useRef(auth.sessionGeneration);
  const mounted = useRef(true), busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  useLayoutEffect(() => {
    session.current = auth.sessionGeneration;
    mounted.current = true;
    return () => { mounted.current = false; };
  }, [auth.sessionGeneration]);
  async function run(operation, accept) {
    if (busy.current) return;
    const generation = session.current;
    const current = () => mounted.current && generation === session.current;
    busy.current = true; setPending(true); setError("");
    try {
      const result = await operation(() => { if (!current()) throw new Error("Account changed"); });
      if (current()) accept(result);
    } catch (failure) {
      if (current()) setError(failure.status === 409 && conflictMessage ? conflictMessage : errorText(failure, fallback));
    } finally {
      busy.current = false;
      if (current()) setPending(false);
    }
  }
  return { run, pending, error };
}
