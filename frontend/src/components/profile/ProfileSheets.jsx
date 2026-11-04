import { useState } from "react";
import { Check, Lock } from "lucide-react";
import { Button, NativeDialog } from "../ui-v2/primitives.jsx";
import Avatar from "./Avatar.jsx";
import { AVATAR_COLOURS, AVATAR_ICONS, DEFAULT_AVATAR_COLOUR, avatarInk } from "./avatarData.js";
import { HANDLE, HANDLE_ERROR, isHandleError, saveMessage } from "./profileForm.js";
import { useProfile } from "./profileState.js";

export function HandleField({ value, onChange, error, id }) {
  return <div className="bv-field"><label htmlFor={id}>Username</label>
    <input id={id} value={value} maxLength={30} autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} onChange={event => onChange(event.target.value.toLowerCase())} />
    <small id={`${id}-help`}>3–30 lowercase letters, numbers or hyphens.</small>
    {error && <p className="bv-field-error" role="alert">{error}</p>}</div>;
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
  const [handle, setHandle] = useState(profile.handle || ""), [error, setError] = useState(""), [pending, setPending] = useState(false);
  const [needsHandle, setNeedsHandle] = useState(!profile.handle);
  async function submit(event) {
    event.preventDefault();
    if (needsHandle && !HANDLE.test(handle)) { setError(HANDLE_ERROR); return; }
    setPending(true); setError("");
    try { await save({ ...(needsHandle ? { handle } : {}), profile_public: true }); onPublic(); onDone(); } catch (requestError) {
      if (requestError?.detail?.code === "handle_required") setNeedsHandle(true); else setError(saveMessage(requestError));
      setPending(false);
    }
  }
  const handleError = isHandleError(error) ? error : "";
  return <form onSubmit={submit} aria-busy={pending}>
    <p>A public profile lets people see your reading year and the lists you choose to share.</p>
    <SheetFacts />
    {needsHandle && <HandleField id="bv-public-handle" value={handle} error={handleError} onChange={setHandle} />}
    {error && !handleError && <p className="bv-field-error" role="alert">{error}</p>}
    <div className="bv-sheet-actions bv-sheet-actions--pinned"><Button type="submit" disabled={pending}>Make public</Button><Button variant="quiet" disabled={pending} onClick={onDone}>Cancel</Button></div>
  </form>;
}

export function MakePublicSheet({ profile, open, onClose, onPublic }) {
  return <NativeDialog open={open} onClose={onClose} title="Make your profile public?" className="bv-profile-sheet">{open && <PublicForm profile={profile} onDone={onClose} onPublic={onPublic} />}</NativeDialog>;
}
