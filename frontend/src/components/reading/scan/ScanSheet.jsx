import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { BookCover, Button, NativeDialog } from "../../ui-v2/primitives.jsx";
import { acceptScan, createRepeatGuard, startDecoder, typedIsbn } from "./decoder.js";
import { isSaveable, saveRow, useScanList } from "./scanList.js";
import "../../../styles/ui-v2/scan-sheet.css";

const stateLine = row => ({
  looking: "Looking up…", waiting: "Looking up…",
  found: row.authors?.join(", ") || "",
  on_shelf: "Already on your shelf",
  not_found: "We’ll find this one — saved for now",
  failed: "Couldn’t look this up.",
}[row.state]);

// The camera: asks for permission, reads barcodes while the sheet is open and the page is showing, and stops every track otherwise.
function useCamera(enabled, onCode) {
  const video = useRef(null), onCodeRef = useRef(onCode);
  const [camera, setCamera] = useState(enabled ? "asking" : "off");
  useEffect(() => { onCodeRef.current = onCode; });
  useEffect(() => {
    if (!enabled) return undefined;
    let stream = null, stop = null, gone = false;
    const release = () => {
      stop?.(); stop = null;
      stream?.getTracks().forEach(track => track.stop()); stream = null;
      if (video.current) video.current.srcObject = null;
    };
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera("none"); return; }
      setCamera("asking");
      try {
        const opened = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (gone || document.hidden) { opened.getTracks().forEach(track => track.stop()); return; }
        stream = opened;
        video.current.srcObject = stream;
        await video.current.play().catch(() => {});
        stop = await startDecoder(video.current, code => onCodeRef.current(code));
        if (gone) release(); else setCamera("on");
      } catch (failure) {
        release();
        if (!gone) setCamera(failure?.name === "NotAllowedError" || failure?.name === "SecurityError" ? "refused" : "none");
      }
    }
    const visibility = () => { if (document.hidden) release(); else if (!stream && !gone) open(); };
    document.addEventListener("visibilitychange", visibility);
    open();
    return () => { gone = true; document.removeEventListener("visibilitychange", visibility); release(); };
  }, [enabled]);
  return { video, camera };
}

function Row({ row, onRemove, onRetry }) {
  const looking = row.state === "looking" || row.state === "waiting";
  const title = row.title || (looking ? row.isbn : `ISBN ${row.isbn}`);
  return <li className={`bv-scan-row is-${row.state}`} data-isbn={row.isbn}>
    <div className="bv-scan-cover" aria-hidden="true">{looking || !row.title ? <span className="bv-scan-cover-blank" /> : <BookCover book={{ title: row.title, cover_image_url: row.cover, authors: [] }} size="small" decorative />}</div>
    <div className="bv-scan-text">
      <p className="bv-scan-title">{title}</p>
      <p className="bv-scan-state" role={row.state === "failed" ? "alert" : undefined}>{stateLine(row)}</p>
    </div>
    {row.state === "failed" && <Button variant="secondary" className="bv-scan-retry" onClick={() => onRetry(row.isbn)}>Retry</Button>}
    <button type="button" className="bv-scan-remove" aria-label={`Remove ${row.title || `ISBN ${row.isbn}`}`} onClick={() => onRemove(row.isbn)}><X aria-hidden="true" /></button>
  </li>;
}

// Scan books: a sheet over My Books. A phone shows the camera and collects what it reads; any screen can type an ISBN, and both feed the
// same list. Add N books saves the whole list at once.
export default function ScanSheet({ open, onClose, camera: wantCamera, initialIsbns = [] }) {
  const library = useUserBooks();
  const list = useScanList();
  const guard = useRef(createRepeatGuard()), seeded = useRef(false);
  const [owned, setOwned] = useState(true), [typed, setTyped] = useState(""), [typedError, setTypedError] = useState(""), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState("");
  const accept = code => {
    if (!acceptScan(code) || !guard.current(code)) return;
    try { navigator.vibrate?.(30); } catch { /* not every device can */ }
    list.add(code);
  };
  const { video, camera } = useCamera(open && wantCamera, accept);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    for (const isbn of initialIsbns) list.add(isbn);
  });
  const lookingUp = list.rows.some(row => row.state === "looking" || row.state === "waiting");
  const saveable = list.rows.filter(isSaveable);

  function submitTyped(event) {
    event.preventDefault();
    const isbn = typedIsbn(typed);
    if (!isbn) { setTypedError("Enter a valid ISBN."); return; }
    setTypedError(""); setTyped(""); list.add(isbn);
  }
  async function addAll() {
    setSaving(true); setSaveError("");
    const failed = [];
    for (const row of saveable) {
      try { await saveRow(row, owned, row.requestId); list.remove(row.isbn); } catch { failed.push(row.isbn); }
    }
    library.readingChanged();
    setSaving(false);
    if (failed.length) { setSaveError("Some books couldn’t be added. Try again."); return; }
    onClose();
  }
  const refusedLine = camera === "refused" || camera === "none";
  return <NativeDialog open={open} onClose={() => { if (!saving) onClose(); }} title="Scan books" className="bv-scan-sheet">
    <div className="bv-scan-body">
      <div className="bv-scan-top">
      {wantCamera && <div className={`bv-scan-camera is-${camera}`}>
        <video ref={video} muted playsInline aria-hidden="true" />
        {camera !== "refused" && camera !== "none" && <p className="bv-scan-hint">Point at the barcode on the back</p>}
      </div>}
      {wantCamera && refusedLine && <p className="bv-scan-notice" role="status">Camera’s off. Type the ISBN instead.</p>}
      <form className="bv-scan-type" onSubmit={submitTyped} noValidate>
        <label htmlFor="bv-scan-isbn">Type an ISBN</label>
        <div className="bv-scan-type-row">
          <input id="bv-scan-isbn" type="text" inputMode="numeric" autoComplete="off" value={typed} aria-invalid={typedError ? "true" : undefined} aria-describedby={typedError ? "bv-scan-isbn-error" : undefined}
            onChange={event => { setTyped(event.target.value); setTypedError(""); }} />
          <Button type="submit" variant="secondary">Add</Button>
        </div>
        {typedError && <p id="bv-scan-isbn-error" className="bv-field-error">{typedError}</p>}
      </form>
      <button type="button" role="switch" aria-checked={owned} aria-label="I own it" className="bv-owned-switch bv-scan-owned" onClick={() => setOwned(value => !value)}>{owned ? "I own it" : "Want to read"}<span className="bv-switch" aria-hidden="true" /></button>
      </div>
      {list.rows.length > 0 && <ul className="bv-scan-list" aria-label="Scanned books">{list.rows.map(row => <Row key={row.isbn} row={row} onRemove={list.remove} onRetry={list.retry} />)}</ul>}
    </div>
    <div className="bv-scan-foot">
      {saveError && <p role="alert" className="bv-field-error">{saveError}</p>}
      <Button className="bv-scan-add" disabled={saveable.length === 0 || lookingUp || saving} onClick={addAll}>{saving ? "Adding…" : `Add ${saveable.length} ${saveable.length === 1 ? "book" : "books"}`}</Button>
    </div>
  </NativeDialog>;
}
