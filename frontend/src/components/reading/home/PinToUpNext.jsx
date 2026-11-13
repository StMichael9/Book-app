import { useState } from "react";
import { getUpNext, putUpNext } from "../../../api/home.js";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { useRequest } from "../../ui-v2/data.js";
import { Button } from "../../ui-v2/primitives.jsx";
import { MAX_PINS } from "./homeLogic.js";
import "../../../styles/ui-v2/home.css";

// A quiet "Pin to Up next" / "Unpin" beside the shelf actions on a book's page. It only appears for a saved book, and only
// where pinning exists (before the endpoint ships, or if it fails, there is simply no button).
// In a book's "more" menu (`menuItem`) it is one menu item, and `onChange` tells the menu what it did.
export default function PinToUpNext({ bookId, menuItem = false, onChange }) {
  const auth = useAuth(), library = useUserBooks();
  const entry = library.booksById[bookId];
  const eligible = auth.isAuthenticated && library.readingActions && !library.readOnly && Boolean(entry?.id) && Boolean(entry?.status);
  const request = useRequest(() => getUpNext().catch(() => null), `book-pins:${auth.sessionGeneration}:${library.revision}`, eligible);
  const [changed, setChanged] = useState({ base: null, pins: null });
  const command = useReadingCommand("Up next couldn’t be updated. Your pins are unchanged.");
  const pins = changed.base === request.data ? changed.pins : request.data;
  if (!eligible || !Array.isArray(pins)) return null;
  const pinned = pins.some(pin => pin.entry_id === entry.id);
  const toggle = () => {
    const next = pinned ? pins.filter(pin => pin.entry_id !== entry.id).map(pin => pin.entry_id) : [...pins.map(pin => pin.entry_id), entry.id];
    command.run(() => putUpNext(next), result => { setChanged({ base: request.data, pins: Array.isArray(result) ? result : [] }); onChange?.(pinned ? "Removed from Up next" : "Pinned to Up next"); });
  };
  const full = !pinned && pins.length >= MAX_PINS;
  if (menuItem) return <>
    <button type="button" role="menuitem" className="bv-more-item" disabled={command.pending || full} aria-describedby={full ? "bv-pin-full" : undefined} onClick={toggle}>{pinned ? "Unpin" : "Pin to Up next"}</button>
    {full && <p id="bv-pin-full" className="bv-help">Up next holds {MAX_PINS} books. Unpin one first.</p>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </>;
  return <div className="bv-pin-action">
    <Button variant="quiet" disabled={command.pending || full} aria-describedby={full ? "bv-pin-full" : undefined} onClick={toggle}>{pinned ? "Unpin" : "Pin to Up next"}</Button>
    {full && <p id="bv-pin-full" className="bv-help">Up next holds {MAX_PINS} books. Unpin one first.</p>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </div>;
}
