import { Bird, BookOpen, Cat, Coffee, Feather, Glasses, Lamp, Leaf, Library, Mountain, Moon, Sun } from "lucide-react";

// The reader's chosen icon on bookcloth. Values match the profile contract (avatar_icon / avatar_color).
export const AVATAR_ICONS = [
  ["book-open", "Open book", BookOpen], ["coffee", "Coffee cup", Coffee], ["cat", "Cat", Cat], ["feather", "Feather", Feather],
  ["moon", "Moon", Moon], ["leaf", "Leaf", Leaf], ["lamp", "Lamp", Lamp], ["glasses", "Glasses", Glasses],
  ["bird", "Bird", Bird], ["mountain", "Mountain", Mountain], ["sun", "Sun", Sun], ["library", "Library", Library],
];
export { AVATAR_COLOURS, DEFAULT_AVATAR_COLOUR, avatarHex, avatarInk } from "./avatarColours.js";
