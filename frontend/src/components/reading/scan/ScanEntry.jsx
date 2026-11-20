import { useState } from "react";
import { Button } from "../../ui-v2/primitives.jsx";
import { useNarrow } from "../home/homeLogic.js";
import { typedIsbn } from "./decoder.js";
import ScanSheet from "./ScanSheet.jsx";

// The My Books add area. A phone gets a Scan books button, which opens the camera. A wider screen gets only a field for typing an ISBN.
// Both open the same sheet and fill the same list.
export default function ScanEntry() {
  const phone = useNarrow();
  const [sheet, setSheet] = useState(null), [typed, setTyped] = useState(""), [error, setError] = useState("");
  const close = () => setSheet(null);
  function submit(event) {
    event.preventDefault();
    const isbn = typedIsbn(typed);
    if (!isbn) { setError("Enter a valid ISBN."); return; }
    setError(""); setTyped(""); setSheet({ camera: false, isbns: [isbn], at: Date.now() });
  }
  return <>
    {phone
      ? <Button variant="secondary" className="bv-scan-open" onClick={() => setSheet({ camera: true, isbns: [], at: Date.now() })}>Scan books</Button>
      : <form className="bv-scan-inline" onSubmit={submit} noValidate>
        <label htmlFor="bv-scan-inline-isbn">Type an ISBN</label>
        <input id="bv-scan-inline-isbn" type="text" inputMode="numeric" autoComplete="off" value={typed} aria-invalid={error ? "true" : undefined} aria-describedby={error ? "bv-scan-inline-error" : undefined}
          onChange={event => { setTyped(event.target.value); setError(""); }} />
        <Button type="submit" variant="secondary">Add</Button>
        {error && <span id="bv-scan-inline-error" className="bv-field-error">{error}</span>}
      </form>}
    {sheet && <ScanSheet key={sheet.at} open onClose={close} camera={sheet.camera} initialIsbns={sheet.isbns} />}
  </>;
}
