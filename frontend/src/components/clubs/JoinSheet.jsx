import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getInviteByCode } from "../../api/clubs.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { useCamera } from "../reading/scan/ScanSheet.jsx";
import { cleanCode, inviteTokenOf } from "./clubFormat.js";
import { INVITE_CODE, JOIN, JOIN_A_CLUB, JOIN_HELP, SCAN_A_QR_CODE, WRONG_CODE } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// Join a club: type the invite code (or scan its QR code), and go on to the usual join page for that club.
export default function JoinSheet({ onClose }) {
  const navigate = useNavigate();
  const [code, setCode] = useState(""), [error, setError] = useState(""), [pending, setPending] = useState(false), [scanning, setScanning] = useState(false), went = useRef(false);
  async function join(event) {
    event.preventDefault();
    const clean = cleanCode(code);
    if (!clean || pending) return;
    setPending(true); setError("");
    try { const preview = await getInviteByCode(clean); navigate(`/c/${preview.token}`); }
    catch (failure) { setError(failure?.status === 404 ? WRONG_CODE : SAVE_FAILED); setPending(false); }
  }
  const scanned = text => {
    if (went.current) return;
    const token = inviteTokenOf(text);
    if (!token) { setError(WRONG_CODE); return; }
    went.current = true; navigate(`/c/${token}`);
  };
  const { video, camera } = useCamera(scanning, scanned, "qr");
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={JOIN_A_CLUB} className="bv-club-sheet">
    <form onSubmit={join} noValidate aria-busy={pending}>
      <div className="bv-field"><label htmlFor="bv-club-code">{INVITE_CODE}</label>
        <input id="bv-club-code" className="bv-club-code-input" value={code} maxLength={20} autoComplete="off" autoCapitalize="characters" spellCheck="false" aria-invalid={error ? "true" : undefined} onChange={event => { setCode(event.target.value.toUpperCase()); setError(""); }} /></div>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending || !cleanCode(code)}>{JOIN}</Button></div>
    </form>
    {scanning && camera !== "refused" && camera !== "none" && <div className={`bv-scan-camera bv-club-qr-camera is-${camera}`}><video ref={video} muted playsInline aria-hidden="true" /></div>}
    <div className="bv-club-actions"><Button variant="secondary" disabled={scanning} onClick={() => { setError(""); setScanning(true); }}>{SCAN_A_QR_CODE}</Button></div>
    <p className="bv-club-help">{JOIN_HELP}</p>
  </NativeDialog>;
}
