import { createContext, useContext, useSyncExternalStore } from "react";
import { ScanQrCode } from "lucide-react";

// The Scan button's icon. One constant, so swapping it during editing is one line.
export const SCAN_ICON = ScanQrCode;

// The one Scan books sheet is opened through this context (see ScanProvider). With no provider, openScan does nothing.
export const ScanContext = createContext({ openScan: () => {} });
export const useScan = () => useContext(ScanContext);

// A touch device, by capability and never by user agent: a coarse pointer. A phone whose browser lacks the camera API still gets the button
// (the sheet then says the camera is off and takes a typed ISBN), so scan is never hidden on a phone. Where matchMedia itself fails, touch points decide.
const subscribe = notify => {
  try { const query = window.matchMedia("(pointer: coarse)"); query.addEventListener("change", notify); return () => query.removeEventListener("change", notify); } catch { return () => {}; }
};
const check = () => {
  try { return window.matchMedia("(pointer: coarse)").matches; } catch { return (navigator.maxTouchPoints || 0) > 0; }
};
export const useCanScan = () => useSyncExternalStore(subscribe, check, () => false);
