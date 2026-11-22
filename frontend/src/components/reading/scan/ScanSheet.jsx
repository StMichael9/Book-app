import { useEffect, useRef, useState } from "react";
import { Check, Flashlight, X } from "lucide-react";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { BookCover, Button, NativeDialog } from "../../ui-v2/primitives.jsx";
import { trackEvent } from "../../ui-v2/events.js";
import { classifyScan, createRepeatGuard, startDecoder, typedIsbn } from "./decoder.js";
import { SCAN_COPY, markTipDone, platformTip, shouldOfferTip } from "./scanCopy.js";
import { isSaveable, saveRow, useScanList } from "./scanList.js";
import "../../../styles/ui-v2/scan-sheet.css";

const DEFAULT_ZOOM = 2, TROUBLE_MS = 8000;
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
  const track = useRef(null);
  const [tools, setTools] = useState({ torch: false, torchOn: false, tip: false });
  useEffect(() => { onCodeRef.current = onCode; });
  useEffect(() => {
    if (!enabled) return undefined;
    let stream = null, stop = null, gone = false, openId = 0;
    const stopTracks = media => media?.getTracks().forEach(track => track.stop());
    // Releasing also retires any open() still waiting on the camera, the video or the decoder.
    const release = () => {
      openId += 1;
      stop?.(); stop = null;
      stopTracks(stream); stream = null; track.current = null;
      if (video.current) video.current.srcObject = null;
      setTools(current => ({ ...current, torch: false, torchOn: false }));
    };
    async function open() {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera("none"); return; }
      const id = ++openId, stale = () => gone || id !== openId;
      setCamera("asking");
      let opened = null, decoderStop = null;
      // Whatever a retired open() started is stopped here, and it changes nothing else.
      const abandon = () => { decoderStop?.(); stopTracks(opened); if (video.current?.srcObject === opened) video.current.srcObject = null; };
      try {
        // The tip is never for the first open. It is for a later open where the browser asks for the camera again, once per device.
        let prompting = true;
        try { const status = await navigator.permissions?.query({ name: "camera" }); if (status) prompting = status.state === "prompt"; } catch { /* no permissions API: a later open counts */ }
        const later = shouldOfferTip(), offerTip = prompting && later;
        if (stale()) return;
        opened = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: { ideal: "environment" } }, audio: false });
        if (stale() || document.hidden) { abandon(); return; }
        stream = opened;
        const found = opened.getVideoTracks?.()[0] || null, capabilities = found?.getCapabilities?.() || {};
        track.current = found;
        const apply = constraint => Promise.resolve(found?.applyConstraints?.({ advanced: [constraint] })).catch(() => {});
        // Continuous focus, and about 2x zoom so the phone can be held 20 to 30 cm away, where it can focus.
        if (capabilities.focusMode?.includes?.("continuous")) apply({ focusMode: "continuous" });
        if (capabilities.zoom) apply({ zoom: Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, DEFAULT_ZOOM)) });
        setTools({ torch: Boolean(capabilities.torch), torchOn: false, tip: offerTip });
        if (offerTip) markTipDone();
        video.current.srcObject = opened;
        await video.current.play().catch(() => {});
        if (stale()) { abandon(); return; }
        decoderStop = await startDecoder(video.current, code => onCodeRef.current(code));
        if (stale()) { abandon(); return; }
        stop = decoderStop; setCamera("on");
      } catch (failure) {
        if (stale()) { abandon(); return; }
        release();
        setCamera(failure?.name === "NotAllowedError" || failure?.name === "SecurityError" ? "refused" : "none");
      }
    }
    const visibility = () => { if (document.hidden) release(); else if (!stream && !gone) open(); };
    document.addEventListener("visibilitychange", visibility);
    open();
    return () => { gone = true; document.removeEventListener("visibilitychange", visibility); release(); };
  }, [enabled]);
  const toggleTorch = () => setTools(current => {
    const torchOn = !current.torchOn;
    Promise.resolve(track.current?.applyConstraints?.({ advanced: [{ torch: torchOn }] })).catch(() => {});
    return { ...current, torchOn };
  });
  const dismissTip = () => { markTipDone(); setTools(current => ({ ...current, tip: false })); };
  return { video, camera, tools, toggleTorch, dismissTip };
}

// What the card over the camera says about the latest scan. The words are the list's own, so the card and the row never disagree.
function cardFor(row, count) {
  const looking = row.state === "looking" || row.state === "waiting";
  const title = row.title || (looking ? row.isbn : `ISBN ${row.isbn}`);
  const line = looking ? "Looking up…" : row.state === "on_shelf" ? "Already on your shelf" : row.state === "failed" ? "Couldn’t look this up." : `Added · ${count} scanned`;
  return { title, line, settled: !looking };
}

function Row({ row, onRemove, onRetry }) {
  const looking = row.state === "looking" || row.state === "waiting";
  const title = row.title || (looking ? row.isbn : `ISBN ${row.isbn}`);
  return <li className={`bv-scan-row is-${row.state}`} data-isbn={row.isbn}>
    <div className="bv-scan-cover" aria-hidden="true">{looking || !row.title ? <span className="bv-scan-cover-blank" /> : <BookCover book={{ title: row.title, cover_image_url: row.cover, authors: [] }} size="small" decorative />}</div>
    <div className="bv-scan-text">
      <p className="bv-scan-title">{title}</p>
      <p className="bv-scan-state" role={row.state === "failed" ? "alert" : undefined}>{stateLine(row)}</p>
      {row.state === "failed" && <Button variant="quiet" className="bv-scan-retry" onClick={() => onRetry(row.isbn)}>Retry</Button>}
    </div>
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
  // The latest accepted scan: a tick on the aiming box for 0.6 s, and a card over the camera until 3 s after its answer (or the next scan).
  const [latest, setLatest] = useState(null), [flash, setFlash] = useState(0), [cardOpen, setCardOpen] = useState(false), scanId = useRef(0);
  const [notIsbn, setNotIsbn] = useState(false), [trouble, setTrouble] = useState(false), [troubleOpen, setTroubleOpen] = useState(false), [idleStamp, setIdleStamp] = useState(0), misread = useRef({ code: "", at: 0 });
  const accept = code => {
    const kind = classifyScan(code);
    // A barcode that is not an ISBN is named only when the same one is read twice within two seconds, so one misread never flashes it.
    if (kind === "non_isbn") {
      const now = Date.now(), seen = misread.current;
      misread.current = { code, at: now };
      if (seen.code === code && now - seen.at < 2000) setNotIsbn(true);
      return;
    }
    if (kind !== "isbn" || !guard.current(code)) return;
    setNotIsbn(false); setTrouble(false); setTroubleOpen(false); setIdleStamp(Date.now());
    try { navigator.vibrate?.(30); } catch { /* not every device can */ }
    list.add(code);
    scanId.current += 1;
    setLatest({ isbn: code, id: scanId.current }); setFlash(scanId.current); setCardOpen(true);
  };
  useEffect(() => {
    if (!flash) return undefined;
    const timer = setTimeout(() => setFlash(0), 600);
    return () => clearTimeout(timer);
  }, [flash]);
  const latestRow = latest ? list.rows.find(row => row.isbn === latest.isbn) : null;
  const card = latestRow ? cardFor(latestRow, list.rows.length) : null;
  const cardSettled = Boolean(card?.settled);
  useEffect(() => {
    if (!latest || !cardSettled) return undefined;
    const timer = setTimeout(() => setCardOpen(false), 3000);
    return () => clearTimeout(timer);
  }, [latest, cardSettled]);
  const showCard = Boolean(cardOpen && card);
  const { video, camera, tools, toggleTorch, dismissTip } = useCamera(open && wantCamera, accept);
  // One count per opening of the camera sheet (the sheet is remounted each time it opens). Counting never blocks the sheet.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current || !open || !wantCamera) return;
    counted.current = true; trackEvent("scan_opened");
  }, [open, wantCamera]);
  // Eight seconds of the camera running with nothing read: offer the tips.
  useEffect(() => {
    if (camera !== "on") return undefined;
    const timer = setTimeout(() => setTrouble(true), TROUBLE_MS);
    return () => clearTimeout(timer);
  }, [camera, idleStamp]);
  useEffect(() => {
    if (!notIsbn) return undefined;
    const timer = setTimeout(() => setNotIsbn(false), 8000);
    return () => clearTimeout(timer);
  }, [notIsbn]);
  const typeIt = () => { document.getElementById("bv-scan-isbn")?.focus(); };
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
    // How many books this Add saved (the server takes 1 to 100 per event).
    if (saveable.length > failed.length) trackEvent("scan_added", { n: Math.min(100, saveable.length - failed.length) });
    library.readingChanged();
    setSaving(false);
    if (failed.length) { setSaveError("Some books couldn’t be added. Try again."); return; }
    onClose();
  }
  return <NativeDialog open={open} onClose={() => { if (!saving) onClose(); }} title="Scan books" className="bv-scan-sheet">
    <div className="bv-scan-body">
      <div className="bv-scan-top">
      {wantCamera && <div className={`bv-scan-camera is-${camera}${flash ? " is-flash" : ""}${showCard ? " has-card" : ""}`}>
        <video ref={video} muted playsInline aria-hidden="true" />
        {tools.torch && <button type="button" className="bv-scan-light" aria-label={tools.torchOn ? SCAN_COPY.lightOff : SCAN_COPY.lightOn} aria-pressed={tools.torchOn} onClick={toggleTorch}><Flashlight size={18} strokeWidth={2} aria-hidden="true" /></button>}
        <div className="bv-scan-aim" aria-hidden="true"><span className="bv-scan-tick"><Check /></span></div>
        {camera !== "refused" && camera !== "none" && <p className="bv-scan-hint">Fit the barcode in the box</p>}
        <div className={`bv-scan-card${showCard ? " is-open" : ""}`} aria-hidden="true">
          <div className="bv-scan-cover">{latestRow?.title ? <BookCover book={{ title: latestRow.title, cover_image_url: latestRow.cover, authors: [] }} size="small" decorative /> : <span className="bv-scan-cover-blank" />}</div>
          <div className="bv-scan-text"><p className="bv-scan-title">{card?.title}</p><p className="bv-scan-state">{card?.line}</p></div>
        </div>
      </div>}
      <p className="bv-sr-only" role="status" aria-live="polite">{showCard && card?.settled ? `${card.title}. ${card.line}` : ""}</p>
      {wantCamera && camera === "refused" && <div className="bv-scan-notice" role="status"><p>{SCAN_COPY.blocked}</p><Button variant="secondary" onClick={typeIt}>{SCAN_COPY.type}</Button></div>}
      {wantCamera && camera === "none" && <p className="bv-scan-notice" role="status">Camera’s off. Type the ISBN instead.</p>}
      {wantCamera && tools.tip && camera === "on" && <div className="bv-scan-notice bv-scan-tip" role="status"><p>{SCAN_COPY.tip}</p>{platformTip() && <p>{platformTip()}</p>}<Button variant="secondary" onClick={dismissTip}>{SCAN_COPY.gotIt}</Button></div>}
      {wantCamera && notIsbn && <div className="bv-scan-notice" role="status"><p><b>{SCAN_COPY.notIsbn}</b></p><p>{SCAN_COPY.notIsbnHelp}</p><Button variant="secondary" onClick={typeIt}>{SCAN_COPY.type}</Button></div>}
      {wantCamera && trouble && camera === "on" && !notIsbn && (troubleOpen
        ? <div className="bv-scan-notice" role="status"><ul className="bv-scan-tips">{[tools.torch && SCAN_COPY.tipLight, SCAN_COPY.tipFurther, SCAN_COPY.tipFlat, SCAN_COPY.tipGlare].filter(Boolean).map(line => <li key={line}>{line}</li>)}</ul><Button variant="secondary" onClick={typeIt}>{SCAN_COPY.type}</Button></div>
        : <button type="button" className="bv-scan-trouble" aria-expanded="false" onClick={() => setTroubleOpen(true)}>{SCAN_COPY.trouble}</button>)}
      <form className="bv-scan-type" onSubmit={submitTyped} noValidate>
        <label htmlFor="bv-scan-isbn">Type an ISBN</label>
        <div className="bv-scan-type-row">
          <input id="bv-scan-isbn" type="text" inputMode="numeric" autoComplete="off" value={typed} aria-invalid={typedError ? "true" : undefined} aria-describedby={typedError ? "bv-scan-isbn-error" : undefined}
            onChange={event => { setTyped(event.target.value); setTypedError(""); }} />
          <Button type="submit" variant="secondary">Add</Button>
        </div>
        {typedError && <p id="bv-scan-isbn-error" className="bv-field-error">{typedError}</p>}
      </form>
      <div className="bv-scan-shelf" role="group" aria-label="Shelf">
        <button type="button" className="bv-scan-pill" aria-pressed={owned} onClick={() => setOwned(true)}>I own it</button>
        <button type="button" className="bv-scan-pill" aria-pressed={!owned} onClick={() => setOwned(false)}>Want to read</button>
      </div>
      </div>
      {list.rows.length > 0 && <ul className="bv-scan-list" aria-label="Scanned books">{list.rows.map(row => <Row key={row.isbn} row={row} onRemove={list.remove} onRetry={list.retry} />)}</ul>}
    </div>
    <div className="bv-scan-foot">
      {saveError && <p role="alert" className="bv-field-error">{saveError}</p>}
      <Button className="bv-scan-add" disabled={saveable.length === 0 || lookingUp || saving} onClick={addAll}>{saving ? "Adding…" : `Add ${saveable.length} ${saveable.length === 1 ? "book" : "books"}`}</Button>
    </div>
  </NativeDialog>;
}
