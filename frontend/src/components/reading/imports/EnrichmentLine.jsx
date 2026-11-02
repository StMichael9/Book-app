import { useEffect, useEffectEvent, useState } from "react";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { importEnrichment } from "../../../api/libraryImports.js";

const INTERVAL = 5000;

// After an import the server keeps looking up covers and descriptions. Check every few seconds while anything is pending and
// the tab is showing; when books upgrade, refresh the library quietly. Any error simply stops the checking.
export default function EnrichmentLine({ runId }) {
  const library = useUserBooks();
  const [pending, setPending] = useState(0);
  const refresh = useEffectEvent(() => library.readingChanged());
  useEffect(() => {
    const controller = new AbortController();
    let timer = null, seen = 0;
    const schedule = () => { timer = setTimeout(poll, INTERVAL); };
    async function poll() {
      if (document.hidden) { schedule(); return; }
      try {
        const result = await importEnrichment(runId, controller.signal);
        if (controller.signal.aborted) return;
        const left = Number(result?.pending) || 0, upgraded = Number(result?.upgraded) || 0;
        setPending(left);
        if (upgraded > seen) { seen = upgraded; refresh(); }
        if (left > 0) schedule();
      } catch { /* Stop quietly; the import itself is already done. */ }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId]);
  return <div role="status" aria-live="polite">{pending > 0 && <p className="bv-help">Finding covers and descriptions for {pending} {pending === 1 ? "book" : "books"}…</p>}</div>;
}
