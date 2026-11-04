import { useState } from "react";
import { BookOpen } from "lucide-react";
import { AVATAR_ICONS, avatarHex, avatarInk } from "./avatarData.js";

// Decorative: the name or link beside it says who this is. `person` is a profile or public profile payload.
export default function Avatar({ person, size = 68, preview }) {
  const icon = preview?.icon ?? person?.avatar_icon, colour = preview?.colour ?? person?.avatar_color;
  const Icon = AVATAR_ICONS.find(([key]) => key === icon)?.[2];
  const key = `${icon || ""}|${colour || ""}`;
  // A change crossfades in; the first paint never animates.
  const [shown, setShown] = useState(key), [fading, setFading] = useState(false);
  if (shown !== key) { setShown(key); setFading(true); }
  const initials = (person?.initials || "").trim();
  // The glyph is about 44% of the diameter, with a heavier stroke on the two small sizes.
  const glyph = { strokeWidth: size <= 32 ? 2 : 1.75, width: Math.round(size * 0.44), height: Math.round(size * 0.44) };
  const face = Icon ? <Icon {...glyph} /> : initials ? <b>{size < 28 ? initials[0] : initials}</b> : <BookOpen {...glyph} />;
  const background = avatarHex(colour);
  return <span className="bv-avatar" aria-hidden="true" style={{ "--bv-avatar-size": `${size}px`, "--bv-avatar-bg": background, "--bv-avatar-ink": avatarInk(background) }}>
    <span key={key} className={`bv-avatar-face${fading ? " is-changing" : ""}`}>{face}</span></span>;
}
