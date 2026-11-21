import { useState } from "react";
import { Heart, ThumbsDown, ThumbsUp } from "lucide-react";
import { updateReadingAttempt } from "../../api/reading.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button } from "../ui-v2/primitives.jsx";
import "../../styles/ui-v2/thumbs.css";

// The three private reactions a reader can give a reading. Nobody else ever sees them.
const REACTIONS = [["loved", "Loved it"], ["liked", "Liked it"], ["not_for_me", "Not for me"]];

function ReactionIcon({ value }) {
  if (value === "loved") return <Heart className="bv-thumbs-heart" aria-hidden="true" />;
  return value === "liked" ? <ThumbsUp aria-hidden="true" /> : <ThumbsDown aria-hidden="true" />;
}

function Pill({ value, label, pressed, disabled, onPick }) {
  return <button type="button" className="bv-thumbs-pill" aria-pressed={pressed} disabled={disabled} onClick={() => onPick(value)}><ReactionIcon value={value} />{label}</button>;
}

const save = (attempt, version, reaction) => updateReadingAttempt(attempt.id, { expected_version: version, reaction });

// "How was it?" where the finish was: three pills and Skip. One tap saves and keeps the title and all three pills, the chosen one
// pressed (another pill changes it, the pressed one clears it); only Skip goes. Skip removes the whole prompt.
export default function ThumbsPrompt({ entry, attempt, minVersion = 0, onSaved, onSkipped }) {
  const command = useReadingCommand();
  const [chosen, setChosen] = useState(null), [picked, setPicked] = useState(false), [skipped, setSkipped] = useState(false), [savedVersion, setSavedVersion] = useState(0);
  if (skipped) return null;
  const version = Math.max(entry.version, savedVersion, minVersion);
  const pick = value => {
    const next = picked && chosen === value ? null : value;
    command.run(() => save(attempt, version, next), result => { setChosen(next); setPicked(true); setSavedVersion(result.entry?.version ?? 0); onSaved?.(result); });
  };
  return <div className="bv-thumbs-prompt">
    <p className="bv-thumbs-title" id={`bv-thumbs-${attempt.id}`}>How was it?</p>
    <div className="bv-thumbs-row" role="group" aria-labelledby={`bv-thumbs-${attempt.id}`}>
      {REACTIONS.map(([value, label]) => <Pill key={value} value={value} label={label} pressed={chosen === value} disabled={command.pending} onPick={pick} />)}
      {!picked && <Button variant="quiet" className="bv-thumbs-skip" disabled={command.pending} onClick={() => { setSkipped(true); onSkipped?.(); }}>Skip</Button>}
    </div>
    {command.error && <p role="alert" className="bv-field-error">{command.error}</p>}
  </div>;
}

// The reaction on a book's page: its own row with the current choice pressed. Another pill changes it; the pressed one clears it.
export function ReactionRow({ entry, attempt, readOnly, minVersion = 0, onSaved }) {
  const command = useReadingCommand();
  const [savedVersion, setSavedVersion] = useState(0);
  if (!attempt || !(["finished", "dnf"].includes(attempt.state) || attempt.reaction)) return null;
  const version = Math.max(entry.version, savedVersion, minVersion);
  const pick = value => command.run(() => save(attempt, version, attempt.reaction === value ? null : value), result => { setSavedVersion(result.entry?.version ?? 0); onSaved?.(result); });
  return <div className="bv-thumbs-reaction">
    <p className="bv-thumbs-title" id={`bv-reaction-${attempt.id}`}>How was it?</p>
    <div className="bv-thumbs-row" role="group" aria-labelledby={`bv-reaction-${attempt.id}`}>
      {REACTIONS.map(([value, label]) => <Pill key={value} value={value} label={label} pressed={attempt.reaction === value} disabled={readOnly || command.pending} onPick={pick} />)}
    </div>
    {command.error && <p role="alert" className="bv-field-error">{command.error}</p>}
  </div>;
}
