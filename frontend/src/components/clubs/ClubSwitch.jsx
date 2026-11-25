// A switch: a real checkbox with role=switch (so it is keyboard- and screen-reader-ready), drawn as a track. `.bv-switch` belongs to My Books, so this is bv-club-.
export default function ClubSwitch({ checked, onChange, disabled = false, children }) {
  return <label className="bv-club-switchrow"><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} /><span className="bv-club-track" aria-hidden="true" /><span>{children}</span></label>;
}
