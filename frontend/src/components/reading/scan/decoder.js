// Reading a barcode on the phone. Camera frames never leave the device: only the ISBN that comes out of them is sent anywhere.

const REPEAT_MS = 3000;

// An EAN-13 is an ISBN only with the 978 or 979 prefix (other prefixes are price or shop codes) and a good check digit.
export function isbn13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}
export const acceptScan = code => typeof code === "string" && /^97[89]/.test(code) && isbn13Valid(code);

// Typed text: hyphens and spaces are ignored, and an ISBN-10 is turned into its ISBN-13. Anything else is null.
export function typedIsbn(text) {
  const clean = String(text ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(clean)) return acceptScan(clean) ? clean : null;
  if (!/^\d{9}[\dX]$/.test(clean)) return null;
  const check = [...clean.slice(0, 9)].reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const last = clean[9] === "X" ? 10 : Number(clean[9]);
  if ((check + last) % 11 !== 0) return null;
  const body = `978${clean.slice(0, 9)}`, sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

// The same ISBN seen again within three seconds is the same scan: the camera keeps looking at the barcode after it was read.
export function createRepeatGuard(windowMs = REPEAT_MS, now = () => Date.now()) {
  const last = new Map();
  return isbn => {
    const time = now(), seen = last.get(isbn);
    if (seen !== undefined && time - seen < windowMs) return false;
    last.set(isbn, time);
    return true;
  };
}

// Starts reading from a playing <video>. BarcodeDetector is used where the browser has it (Android Chrome); otherwise zxing is
// loaded on demand, so it is not part of the main bundle. Returns a stop function. `onCode` gets every EAN-13 value seen.
export async function startDecoder(video, onCode) {
  if (typeof window !== "undefined" && "BarcodeDetector" in window) {
    const detector = new window.BarcodeDetector({ formats: ["ean_13"] });
    let stopped = false, timer = 0, busy = false;
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { for (const code of await detector.detect(video)) onCode(code.rawValue); } catch { /* a frame that cannot be read is skipped */ }
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(tick, 150);
    };
    tick();
    return () => { stopped = true; window.clearTimeout(timer); };
  }
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13]]]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
  const controls = await reader.decodeFromVideoElement(video, result => { if (result) onCode(result.getText()); });
  return () => controls.stop();
}
