import { useRef, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { updateReadingAttempt } from "../../api/reading.js";
import { useReadingCommand } from "../../hooks/useReadingCommand.js";
import { Button } from "../ui-v2/primitives.jsx";
import "../../styles/ui-v2/thumbs.css";

// The three private reactions a reader can give a reading. Nobody else ever sees them.
const REACTIONS = [["loved", "Loved it"], ["liked", "Liked it"], ["not_for_me", "Not for me"]];

function ReactionIcon({ value }) {
  if (value === "loved") return <span className="bv-thumbs-two" aria-hidden="true"><ThumbsUp /><ThumbsUp /></span>;
  return value === "liked" ? <ThumbsUp aria-hidden="true" /> : <ThumbsDown aria-hidden="true" />;
}

function Pill({ value, label, pressed, disabled, onPick }) {
  return <button type="button" className="bv-thumbs-pill" aria-pressed={pressed} disabled={disabled} onClick={() => onPick(value)}><ReactionIcon value={value} />{label}</button>;
}

const save = (attempt, version, reaction) => updateReadingAttempt(attempt.id, { expected_version: version, reaction });

// "How was it?" where the finish was: three pills and Skip. One tap saves, and the prompt is replaced by the chosen pill at the same
// height, so nothing moves. Skip removes it.
export default function ThumbsPrompt({ entry, attempt, minVersion = 0, onSaved, onSkipped }) {
  const command = useReadingCommand();
  const box = useRef(null);
  const [chosen, setChosen] = useState(null), [skipped, setSkipped] = useState(false), [height, setHeight] = useState(0), [savedVersion, setSavedVersion] = useState(0);
  if (skipped) return null;
  const version = Math.max(entry.version, savedVersion, minVersion);
  const pick = value => {
    const reserved = box.current?.offsetHeight || 0;
    command.run(() => save(attempt, version, value), result => { setHeight(reserved); setChosen(value); setSavedVersion(result.entry?.version ?? 0); onSaved?.(result); });
  };
  return <div className="bv-thumbs-prompt" ref={box} style={height ? { minHeight: height } : undefined}>
    {chosen ? <div className="bv-thumbs-row"><Pill value={chosen} label={REACTIONS.find(([value]) => value === chosen)[1]} pressed disabled onPick={() => {}} /></div> : <>
      <p className="bv-thumbs-title" id={`bv-thumbs-${attempt.id}`}>How was it?</p>
      <div className="bv-thumbs-row" role="group" aria-labelledby={`bv-thumbs-${attempt.id}`}>
        {REACTIONS.map(([value, label]) => <Pill key={value} value={value} label={label} pressed={false} disabled={command.pending} onPick={pick} />)}
        <Button variant="quiet" className="bv-thumbs-skip" disabled={command.pending} onClick={() => { setSkipped(true); onSkipped?.(); }}>Skip</Button>
      </div>
      {command.error && <p role="alert" className="bv-field-error">{command.error}</p>}
    </>}
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
