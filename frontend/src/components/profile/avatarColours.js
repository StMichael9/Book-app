// The six bookcloth colours (avatar_color) and the ink that stays readable on each.
export const AVATAR_COLOURS = [
  ["green", "Green", "#28513f"], ["rust", "Rust", "#9c432d"], ["ink", "Ink blue", "#2f4a6b"],
  ["mustard", "Mustard", "#b8862b"], ["plum", "Plum", "#6b3f5e"], ["sage", "Sage", "#5f7d66"],
];
export const DEFAULT_AVATAR_COLOUR = "green";
export const AVATAR_LIGHT = "#fffdf5", AVATAR_DARK = "#1a251f";
export const avatarHex = name => (AVATAR_COLOURS.find(([key]) => key === name) || AVATAR_COLOURS[0])[2];

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (first, second) => { const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a); return (high + 0.05) / (low + 0.05); };
// The warm light ink when it reaches 4.5:1 on the colour; otherwise plain white, then the dark ink, whichever first does.
export const AVATAR_WHITE = "#ffffff";
export const avatarInk = hex => [AVATAR_LIGHT, AVATAR_WHITE, AVATAR_DARK].find(ink => contrast(ink, hex) >= 4.5) || AVATAR_DARK;
