import { useCallback, useMemo, useState } from "react";
import ScanSheet from "../reading/scan/ScanSheet.jsx";
import { ScanContext } from "./scanKit.js";

// The one Scan books sheet for the whole app. The header button, the My Books add area and Home's first-run card all call openScan();
// the sheet is mounted here, once, so there is never a second copy. Closing it hands focus back to whatever opened it (NativeDialog does that).
// openScan() opens the camera; openScan({ camera: false, isbns: [isbn] }) opens the list with a typed ISBN already in it.
export default function ScanProvider({ children }) {
  const [sheet, setSheet] = useState(null);
  const openScan = useCallback((options = {}) => setSheet({ camera: options.camera ?? true, isbns: options.isbns || [], at: Date.now() }), []);
  const value = useMemo(() => ({ openScan }), [openScan]);
  return <ScanContext.Provider value={value}>
    {children}
    {sheet && <ScanSheet key={sheet.at} open onClose={() => setSheet(null)} camera={sheet.camera} initialIsbns={sheet.isbns} />}
  </ScanContext.Provider>;
}
