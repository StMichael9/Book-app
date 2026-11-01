import { useSyncExternalStore } from "react";
import { isServiceDown } from "../api/client.js";

function subscribe(notify) {
  window.addEventListener("bookvane:unavailable", notify);
  window.addEventListener("bookvane:available", notify);
  return () => { window.removeEventListener("bookvane:unavailable", notify); window.removeEventListener("bookvane:available", notify); };
}

// True while the outage banner is showing.
export const useServiceDown = () => useSyncExternalStore(subscribe, isServiceDown, () => false);
