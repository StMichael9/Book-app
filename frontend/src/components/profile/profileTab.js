import { useState } from "react";
import { useSearchParams } from "react-router-dom";

export const PROFILE_TABS = [["overview", "Overview"], ["lists", "Lists"], ["year", "Year"]];

// The tab lives in ?tab=lists|year (Overview is the default), so Back works and a tab can be linked.
export function useProfileTab() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = PROFILE_TABS.some(([key]) => key === raw) && raw !== "overview" ? raw : "overview";
  const change = (next, { replace = false } = {}) => setParams(next === "overview" ? {} : { tab: next }, { replace });
  // The panel settles in only after the tab has changed (a click, the keyboard or Back), never on the first paint.
  const [previous, setPrevious] = useState(tab), [switched, setSwitched] = useState(false);
  if (previous !== tab) { setPrevious(tab); setSwitched(true); }
  return [tab, change, switched];
}
