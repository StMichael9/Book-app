import { AVATAR_COLOURS } from "./avatarData.js";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A small stable hash, so a spine's height and cloth never change between visits.
export function hash(...parts) {
  let value = 2166136261;
  for (const char of parts.join(":")) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}
export const clothFor = (...parts) => AVATAR_COLOURS[hash(...parts) % AVATAR_COLOURS.length][2];
