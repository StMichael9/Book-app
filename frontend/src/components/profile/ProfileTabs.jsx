import { useRef } from "react";
import { PROFILE_TABS } from "./profileTab.js";

// A real tablist: arrow keys move between the tabs, Home and End jump to the ends, and only the selected tab is in the tab order.
export function TabBar({ value, onChange, label = "Profile sections" }) {
  const refs = useRef({});
  function onKeyDown(event) {
    const index = PROFILE_TABS.findIndex(([key]) => key === value);
    const last = PROFILE_TABS.length - 1;
    const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = PROFILE_TABS[next][0];
    onChange(key, { replace: true });
    refs.current[key]?.focus();
  }
  return <div className="bv-profile-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
    {PROFILE_TABS.map(([key, text]) => <button key={key} ref={node => { refs.current[key] = node; }} type="button" role="tab" id={`bv-tab-${key}`} className={`bv-profile-tab${key === value ? " is-selected" : ""}`}
      aria-selected={key === value} aria-controls="bv-tab-panel" tabIndex={key === value ? 0 : -1} onClick={() => onChange(key)}>{text}</button>)}
  </div>;
}

export function TabPanel({ value, settle = false, children }) {
  return <div className={`bv-profile-tab-panel${settle ? " is-settling" : ""}`} role="tabpanel" id="bv-tab-panel" aria-labelledby={`bv-tab-${value}`} tabIndex={0}>{children}</div>;
}
