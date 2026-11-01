import { useEffect, useEffectEvent, useState } from "react";

const valid = data => data && typeof data === "object" && (data.text === null || typeof data.text === "string");

// Asks the server which description to show. Until it answers, callers keep what the page already has; an unusable or
// failed answer reports "error" so they can fall back to exactly what they showed before.
export function useDescription(load, key, enabled = true) {
  const run = useEffectEvent(load);
  const [state, setState] = useState({ key: null, status: "loading", data: null });
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    run().then(
      data => { if (active) setState(valid(data) ? { key, status: "ok", data } : { key, status: "error", data: null }); },
      () => { if (active) setState({ key, status: "error", data: null }); },
    );
    return () => { active = false; };
  }, [key, enabled]);
  return state.key === key ? state : { key, status: "loading", data: null };
}
