# November 14: theme follows the device

Settings → Theme is now **Match device** (the default), **Light** and **Dark**, a radio group with the legend "Theme"; the "Switch theme" button is gone.

- **Match device** follows `prefers-color-scheme` and changes live when the device does (a `matchMedia` change listener), with no reload.
- **Storage:** `bookvane-theme` holds `"light"`, `"dark"` or nothing. Match device removes the key. Applying a theme never writes; only choosing one does (the old write on every render is fixed).
- **One-time migration** (marker `bookvane-theme-migrated`): a saved value equal to what the device gives now is removed (the reader gets Match device); any other value is kept as their choice. The old `shelfbound-theme` value goes through the same rule and is removed.
- **`index.html` bootstrap** applies the same rule before first paint (migration included), so there is no flash. `theme-color` now follows the shown theme (paper in light, the dark page colour in dark).
- **Guests always match the device.** The stored choice only applies to a signed-in reader, including while the account check runs for a browser remembered as signed in (the sign-in hint), in both the bootstrap and the app.
- `src/components/ui-v2/theme.js` holds the shared logic; the provider exposes `themeChoice`, `chooseTheme` and (for older callers) `setTheme`, which is an explicit choice.
- **Tests:** theme-device.spec.js (12). Tests that forced a theme through storage also emulate the device (a guest follows the device); "Switch theme" clicks now pick Light or Dark; the M6 first-paint scenarios are rewritten for the new rule and the old switch-and-reload test is covered by theme-device.spec.js.
- **Also fixed:** the phone bottom bar hid itself whenever a radio had focus (it hid for any focused non-checkbox input); radios are now excluded.
