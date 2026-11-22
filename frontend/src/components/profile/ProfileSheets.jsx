import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { checkHandle, getHandleSuggestion } from "../../api/profile.js";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import Avatar from "./Avatar.jsx";
import { AVATAR_COLOURS, AVATAR_ICONS, DEFAULT_AVATAR_COLOUR, avatarInk } from "./avatarData.js";
import { HANDLE, HANDLE_ERROR, isHandleError, saveMessage } from "./profileForm.js";
import { useProfile } from "./profileState.js";

export function HandleField({ value, onChange, error, id, status }) {
  return <div className="bv-field"><label htmlFor={id}>Username</label>
    <input id={id} value={value} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} onChange={event => onChange(event.target.value.toLowerCase())} />
    <small id={`${id}-help`}>3–30 lowercase letters, numbers or hyphens.</small>
    {error && <p className="bv-field-error" role="alert">{error}</p>}
    {!error && status === "available" && <p className="bv-handle-status" role="status"><Check aria-hidden="true" size={18} strokeWidth={2} />Available</p>}
    {!error && status === "taken" && <p className="bv-handle-status bv-handle-status--taken" role="status">Taken. Try another.</p>}</div>;
}

// Checks a typed handle 400 ms after the last key. The answer is kept with the handle it was for, so a late answer for an
// older value is ignored. Nothing is asked for an invalid handle or for the one already saved.
function useHandleCheck(handle, enabled, saved) {
  const [result, setResult] = useState({ handle: "", status: null });
  useEffect(() => {
    if (!enabled || handle === saved || !HANDLE.test(handle)) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      checkHandle(handle).then(answer => { if (live) setResult({ handle, status: answer?.available ? "available" : answer?.reason === "handle_taken" ? "taken" : "unavailable" }); }, () => {});
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  }, [handle, enabled, saved]);
  return result.handle === handle && enabled ? result.status : null;
}

// What a public profile shows and never shows; the same two lines on the one-time sheet and the Make public confirm.
export function SheetFacts() {
  return <ul className="bv-sheet-facts"><li><Check aria-hidden="true" />Shown: your name, bio, yearly stats, and shared lists</li><li><Lock aria-hidden="true" />Always private: notes, ratings, reading history, and private lists</li></ul>;
}

// ---- Edit profile ----------------------------------------------------------------------------------------------

function Picker({ legend, children }) {
  return <fieldset className="bv-picker"><legend>{legend}</legend>{children}</fieldset>;
}

function EditForm({ profile, onDone }) {
  const { save } = useProfile();
  const [form, setForm] = useState({ display_name: profile.display_name || "", handle: profile.handle || "", bio: profile.bio || "",
    avatar_icon: profile.avatar_icon || null, avatar_color: profile.avatar_color || DEFAULT_AVATAR_COLOUR });
  const [error, setError] = useState(""), [pending, setPending] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const changes = {};
    for (const field of ["display_name", "handle", "bio"]) if (form[field].trim() !== (profile[field] || "")) changes[field] = form[field].trim();
    if (form.avatar_icon !== (profile.avatar_icon || null)) changes.avatar_icon = form.avatar_icon;
    if (form.avatar_color !== (profile.avatar_color || DEFAULT_AVATAR_COLOUR)) changes.avatar_color = form.avatar_color;
    if (changes.handle && !HANDLE.test(changes.handle)) { setError(HANDLE_ERROR); return; }
    if (!Object.keys(changes).length) { onDone(); return; }
    setPending(true); setError("");
    try { await save(changes); onDone(); } catch (requestError) { setError(saveMessage(requestError)); setPending(false); }
  }
  const handleError = isHandleError(error) ? error : "";
  return <form className="bv-profile-edit" onSubmit={submit} aria-busy={pending}>
    <div className="bv-picker-preview"><Avatar size={96} person={profile} preview={{ icon: form.avatar_icon, colour: form.avatar_color }} /></div>
    <Picker legend="Icon"><div className="bv-icon-grid">{AVATAR_ICONS.map(([key, label, Icon]) => <label key={key} className="bv-pick">
      <input type="radio" name="avatar_icon" value={key} checked={form.avatar_icon === key} onChange={() => setForm({ ...form, avatar_icon: key })} />
      <span><Icon aria-hidden="true" /></span><b className="bv-sr-only">{label}</b></label>)}</div></Picker>
    <Picker legend="Colour"><div className="bv-colour-grid">{AVATAR_COLOURS.map(([key, label, hex]) => <label key={key} className="bv-pick bv-pick--colour">
      <input type="radio" name="avatar_color" value={key} checked={form.avatar_color === key} onChange={() => setForm({ ...form, avatar_color: key })} />
      <span style={{ background: hex, "--bv-pick-ink": avatarInk(hex) }}><Check aria-hidden="true" /></span><em>{label}</em></label>)}</div></Picker>
    <div className="bv-field"><label htmlFor="bv-profile-name">Name</label><input id="bv-profile-name" value={form.display_name} maxLength={40} placeholder="Add your name" autoComplete="name" onChange={event => setForm({ ...form, display_name: event.target.value })} /></div>
    <HandleField id="bv-profile-handle" value={form.handle} error={handleError} onChange={handle => setForm({ ...form, handle })} />
    <div className="bv-field"><label htmlFor="bv-profile-bio">Bio</label><textarea id="bv-profile-bio" rows={3} value={form.bio} maxLength={160} aria-describedby="bv-profile-bio-count" onChange={event => setForm({ ...form, bio: event.target.value })} /><small id="bv-profile-bio-count">{form.bio.length}/160</small></div>
    {error && !handleError && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-sheet-actions bv-sheet-actions--pinned"><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button><Button variant="quiet" disabled={pending} onClick={onDone}>Cancel</Button></div>
  </form>;
}

// A bottom sheet on phones and a dialog on desktop. The form mounts only while open, so it always starts from the saved profile.
export function EditProfileSheet({ profile, open, onClose }) {
  return <NativeDialog open={open} onClose={onClose} title="Edit profile" className="bv-profile-sheet bv-profile-sheet--edit">{open && <EditForm profile={profile} onDone={onClose} />}</NativeDialog>;
}

// ---- Make public -----------------------------------------------------------------------------------------------

function PublicForm({ profile, onDone, onPublic }) {
  const { save } = useProfile();
  const saved = profile.handle || "";
  const [handle, setHandle] = useState(saved), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [changing, setChanging] = useState(false), [suggesting, setSuggesting] = useState(!saved);
  // Someone with no handle gets a suggestion from their name, so Make public works in one tap. If it can't be fetched, they type one.
  useEffect(() => {
    if (saved) return undefined;
    let live = true;
    getHandleSuggestion().then(answer => { if (live && answer?.handle) setHandle(current => current || answer.handle); else if (live) setChanging(true); }, () => { if (live) setChanging(true); })
      .finally(() => { if (live) setSuggesting(false); });
    return () => { live = false; };
  }, [saved]);
  const status = useHandleCheck(handle, changing, saved);
  async function submit(event) {
    event.preventDefault();
    if (handle !== saved && !HANDLE.test(handle)) { setChanging(true); setError(HANDLE_ERROR); return; }
    setPending(true); setError("");
    try { await save({ ...(handle !== saved ? { handle } : {}), profile_public: true }); onPublic(); onDone(); } catch (requestError) {
      if (requestError?.detail?.code === "handle_required") setChanging(true); else setError(saveMessage(requestError));
      setPending(false);
    }
  }
  const handleError = isHandleError(error) ? error : "";
  return <form onSubmit={submit} aria-busy={pending}>
    <p>A public profile lets people see your reading year and the lists you choose to share.</p>
    <SheetFacts />
    {handle && <p className="bv-handle-link">Your link: bookvane.me/u/{handle}{!changing && <Button variant="quiet" className="bv-link-button" onClick={() => setChanging(true)}>Change</Button>}</p>}
    {changing && <HandleField id="bv-public-handle" value={handle} error={handleError} status={status} onChange={value => { setHandle(value); setError(""); }} />}
    {error && !handleError && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-sheet-actions bv-sheet-actions--pinned"><Button type="submit" disabled={pending || suggesting}>Make public</Button><Button variant="quiet" disabled={pending} onClick={onDone}>Cancel</Button></div>
  </form>;
}

export function MakePublicSheet({ profile, open, onClose, onPublic }) {
  return <NativeDialog open={open} onClose={onClose} title="Make your profile public?" className="bv-profile-sheet">{open && <PublicForm profile={profile} onDone={onClose} onPublic={onPublic} />}</NativeDialog>;
}
