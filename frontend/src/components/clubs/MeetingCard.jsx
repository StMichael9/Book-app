import { useState } from "react";
import { CalendarPlus, MapPin } from "lucide-react";
import { meetingCalendarUrl, setRsvp } from "../../api/clubs.js";
import { meetingWhen } from "./clubFormat.js";
import { ADD_TO_CALENDAR, JOIN_CALL, NEXT_MEETING, RSVP_CHOICES, VIDEO_CALL, rsvpCounts } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";

// The next meeting: when, where, your answer (one tap, shown to the club as counts) and Add to calendar. Your answer is saved at once; if the save fails it
// goes back to what it was, with the usual save-error line.
export default function MeetingCard({ clubId, meeting, onAnswered }) {
  const [answer, setAnswer] = useState(null), [counts, setCounts] = useState(null), [error, setError] = useState("");
  const mine = answer === null ? meeting.my_rsvp ?? "" : answer, shown = counts || meeting.counts || {};
  async function choose(status) {
    if (status === mine) return;
    const before = { answer, counts };
    const next = { ...shown };
    if (mine) next[mine] = Math.max(0, (next[mine] || 0) - 1);
    next[status] = (next[status] || 0) + 1;
    setAnswer(status); setCounts(next); setError("");
    try {
      const saved = await setRsvp(clubId, meeting.id, status);
      setAnswer(saved?.my_rsvp ?? status); setCounts(saved?.counts || next);
      onAnswered?.();
    } catch { setAnswer(before.answer); setCounts(before.counts); setError(SAVE_FAILED); }
  }
  const line = rsvpCounts(shown);
  return <section className="bv-club-meeting" aria-labelledby="bv-club-meeting-h">
    <h2 id="bv-club-meeting-h" className="bv-club-label">{NEXT_MEETING}</h2>
    <p className="bv-club-when">{meetingWhen(meeting.starts_at)}</p>
    {(meeting.place || meeting.link) && <p className="bv-club-where"><MapPin aria-hidden="true" /><span>{meeting.place || VIDEO_CALL}</span>
      {meeting.link && <a className="bv-club-link-button" href={meeting.link} target="_blank" rel="noopener noreferrer">{JOIN_CALL}</a>}</p>}
    <div className="bv-club-rsvp-group" role="radiogroup" aria-labelledby="bv-club-meeting-h">
      {RSVP_CHOICES.map(([key, text]) => <label key={key} className="bv-club-rsvp-choice">
        <input type="radio" name={`bv-club-rsvp-${meeting.id}`} value={key} checked={mine === key} onChange={() => choose(key)} /><span>{text}</span></label>)}
    </div>
    <div className="bv-club-meeting-foot">
      {line && <p className="bv-club-group">{line}</p>}
      <a className="bv-club-pill" href={meetingCalendarUrl(clubId, meeting.id)} download><CalendarPlus aria-hidden="true" />{ADD_TO_CALENDAR}</a>
    </div>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
  </section>;
}
