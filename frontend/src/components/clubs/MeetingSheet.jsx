import { useState } from "react";
import { createMeeting, updateMeeting } from "../../api/clubs.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import { isoOf } from "./clubFormat.js";
import { DATE, PLAN_THE_MEETING, QUESTIONS_OPTIONAL, SAVE_MEETING, TIME, WHERE } from "./clubCopy.js";

const SAVE_FAILED = "That couldn’t be saved. Please try again.";
const clock = date => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// Plan the meeting (owners and admins): a date, a time, where (a place, or a video link), and up to five questions, one per line. The same sheet edits
// the meeting that is already planned.
export default function MeetingSheet({ clubId, meeting, onClose, onSaved }) {
  const start = meeting ? new Date(meeting.starts_at) : null;
  const [date, setDate] = useState(start ? isoOf(start) : ""), [time, setTime] = useState(start ? clock(start) : "");
  const [where, setWhere] = useState(meeting?.link || meeting?.place || ""), [questions, setQuestions] = useState((meeting?.questions || []).join("\n"));
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (pending || !date || !time) return;
    const text = where.trim(), isLink = /^https:\/\//i.test(text);
    const data = { starts_at: new Date(`${date}T${time}`).toISOString(), questions: questions.split("\n").map(line => line.trim()).filter(Boolean).slice(0, 5),
      ...(meeting ? { place: isLink ? null : text || null, link: isLink ? text : null } : text ? (isLink ? { link: text } : { place: text }) : {}) };
    setPending(true); setError("");
    try { const saved = meeting ? await updateMeeting(clubId, meeting.id, data) : await createMeeting(clubId, data); onSaved(saved); }
    catch { setError(SAVE_FAILED); setPending(false); }
  }
  return <NativeDialog open onClose={() => { if (!pending) onClose(); }} title={PLAN_THE_MEETING} className="bv-club-sheet">
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <div className="bv-club-duo">
        <div className="bv-field"><label htmlFor="bv-club-meeting-date">{DATE}</label><input id="bv-club-meeting-date" type="date" value={date} onChange={event => { setDate(event.target.value); setError(""); }} /></div>
        <div className="bv-field"><label htmlFor="bv-club-meeting-time">{TIME}</label><input id="bv-club-meeting-time" type="time" value={time} onChange={event => { setTime(event.target.value); setError(""); }} /></div>
      </div>
      <div className="bv-field"><label htmlFor="bv-club-meeting-where">{WHERE}</label><input id="bv-club-meeting-where" value={where} maxLength={500} autoComplete="off" onChange={event => setWhere(event.target.value)} /></div>
      <div className="bv-field"><label htmlFor="bv-club-meeting-questions">{QUESTIONS_OPTIONAL}</label><textarea id="bv-club-meeting-questions" rows={4} value={questions} onChange={event => setQuestions(event.target.value)} /></div>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
      <div className="bv-form-actions"><Button type="submit" disabled={pending || !date || !time}>{SAVE_MEETING}</Button></div>
    </form>
  </NativeDialog>;
}
