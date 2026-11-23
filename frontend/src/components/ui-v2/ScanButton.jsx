import { SCAN_LABEL } from "./findabilityCopy.js";
import { SCAN_ICON, useCanScan, useScan } from "./scanKit.js";
import "../../styles/ui-v2/findability.css";

// An icon-only button: an 18px icon in a 44px round target. It lives wherever the caller puts it and knows nothing about the header, so moving
// it (to Home, My Books, ...) is a change of where it is rendered, nothing more. It shows only on a touch device (see scanKit.js).
export default function ScanButton({ className = "" }) {
  const { openScan } = useScan();
  const canScan = useCanScan();
  const Icon = SCAN_ICON;
  if (!canScan) return null;
  return <button type="button" className={`bv-find-scan${className ? ` ${className}` : ""}`} aria-label={SCAN_LABEL} onClick={() => openScan()}><Icon aria-hidden="true" /></button>;
}
