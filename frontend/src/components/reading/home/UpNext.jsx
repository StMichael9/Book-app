import { useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { putUpNext } from "../../../api/home.js";
import { useReadingCommand } from "../../../hooks/useReadingCommand.js";
import { Button } from "../../ui-v2/primitives.jsx";
import PickCard from "./PickCard.jsx";
import { MAX_PINS, UP_NEXT_SHOWN, startReading } from "./homeLogic.js";


// The reader's pinned list (or the shelf's suggestions) with Start on each book; Edit reorders and unpins without dragging.
export default function UpNext({ pins, suggested, canEdit, readOnly, onPinsChanged }) {
  const go = useNavigate(), command = useReadingCommand("Up next couldn’t start that book. Please try again.");
  const edit = useReadingCommand("Up next couldn’t be updated. Your pins are unchanged.");
  const [editing, setEditing] = useState(false), [pending, setPending] = useState(null);
  const editButton = useRef(null), live = useRef(null);
  const pinned = Array.isArray(pins) && pins.length > 0;
  const cards = pinned ? pins.map(pin => ({ ...pin, authors: pin.authors || [], label: pin.owned ? "Owned" : "Want to read", pinned: true })) : suggested;
  if (!cards.length) return null;
  function start(card) {
    setPending(card.entry_id);
    command.run(() => startReading(card.entry_id), () => go(`/my-books/${card.entry_id}`));
  }
  function save(next, announce) {
    edit.run(() => putUpNext(next.map(card => card.entry_id)), result => { onPinsChanged(result); if (live.current) live.current.textContent = announce; });
  }
  const move = (index, step) => { const next = [...pins]; [next[index], next[index + step]] = [next[index + step], next[index]]; save(next, `${pins[index].title} moved ${step < 0 ? "up" : "down"}`); };
  const unpin = index => save(pins.filter((_, at) => at !== index), `${pins[index].title} unpinned`);
  const done = () => { setEditing(false); editButton.current?.focus(); };
  return <section className="bv-up-next" aria-labelledby="bv-up-next-title">
    <div className="bv-section-head"><div><h2 id="bv-up-next-title">Up next</h2><p className="bv-muted">{pinned ? `Pinned by you · ${pins.length} of ${MAX_PINS}` : "Suggested from your shelf"}</p></div>
      {pinned && canEdit && !readOnly && (editing ? <Button variant="quiet" onClick={done}>Done</Button> : <Button ref={editButton} variant="quiet" onClick={() => setEditing(true)}>Edit</Button>)}</div>
    {editing && pinned ? <>
      <ol className="bv-pin-list">{pins.map((pin, index) => <li key={pin.entry_id}>
        <span className="bv-pin-title">{pin.title}</span>
        <span className="bv-pin-actions">
          <Button variant="quiet" className="bv-icon-button" aria-label={`Move ${pin.title} up`} disabled={index === 0 || edit.pending} onClick={() => move(index, -1)}><ArrowUp aria-hidden="true" /></Button>
          <Button variant="quiet" className="bv-icon-button" aria-label={`Move ${pin.title} down`} disabled={index === pins.length - 1 || edit.pending} onClick={() => move(index, 1)}><ArrowDown aria-hidden="true" /></Button>
          <Button variant="quiet" aria-label={`Unpin ${pin.title}`} disabled={edit.pending} onClick={() => unpin(index)}>Unpin</Button>
        </span></li>)}</ol>
      {edit.error && <p className="bv-field-error" role="alert">{edit.error}</p>}
      <p className="bv-sr-only" role="status" ref={live} />
    </> : <div className="bv-next-row">{cards.slice(0, UP_NEXT_SHOWN).map(card => <PickCard key={card.entry_id} card={card} label={card.pinned ? `${card.label} · Pinned` : card.label} onStart={start} pending={pending === card.entry_id} disabled={readOnly || command.pending} />)}</div>}
    {command.error && <p className="bv-field-error" role="alert">{command.error}</p>}
  </section>;
}
