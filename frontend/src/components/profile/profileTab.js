import { useSearchParams } from "react-router-dom";

export const PROFILE_TABS = [["overview", "Overview"], ["lists", "Lists"], ["year", "Year"]];

// The tab lives in ?tab=lists|year (Overview is the default), so Back works and a tab can be linked.
export function useProfileTab() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = PROFILE_TABS.some(([key]) => key === raw) && raw !== "overview" ? raw : "overview";
  const change = (next, { replace = false } = {}) => setParams(next === "overview" ? {} : { tab: next }, { replace });
  return [tab, change];
}
