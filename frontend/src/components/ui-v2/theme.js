// Theme: Match device (the default), Light or Dark. Only a choice the reader makes is stored, under `bookvane-theme` as "light" or
// "dark"; Match device stores nothing. The inline bootstrap in index.html applies the same rule before first paint.
export const THEME_KEY = "bookvane-theme";
export const MIGRATED_KEY = "bookvane-theme-migrated";
const LEGACY_KEY = "shelfbound-theme";
// The browser's own colour (address bar, status bar) follows the shown theme: the page background of each.
export const THEME_COLOR = { light: "#f3eee3", dark: "#16130f" };

const valid = value => value === "light" || value === "dark";

export const systemTheme = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

// Older versions saved a theme on every first visit, even for people who never chose. Once, on the first load after this
// release: a saved value that equals what the device gives now is dropped (they get Match device); any other value is kept as
// their Light or Dark choice.
export function migrateTheme() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const current = localStorage.getItem(THEME_KEY), legacy = localStorage.getItem(LEGACY_KEY);
    const saved = valid(current) ? current : valid(legacy) ? legacy : null;
    if (saved === null || saved === systemTheme()) localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, saved);
    localStorage.removeItem(LEGACY_KEY);
    localStorage.setItem(MIGRATED_KEY, "1");
  } catch { /* Storage is optional: without it the theme simply matches the device. */ }
}

// "light", "dark" or "device".
export function readChoice() {
  migrateTheme();
  try {
    const current = localStorage.getItem(THEME_KEY);
    if (valid(current)) return current;
    const legacy = localStorage.getItem(LEGACY_KEY); // only when storage refused the migration's write
    if (valid(legacy)) return legacy;
  } catch { /* See above. */ }
  return "device";
}

export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
}

export function storeChoice(choice) {
  try {
    if (choice === "device") localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice);
  } catch { /* The choice still applies for this visit. */ }
}
