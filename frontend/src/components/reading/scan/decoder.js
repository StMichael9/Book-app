// Reading a barcode on the phone. Camera frames never leave the device: only the ISBN that comes out of them is sent anywhere.

const REPEAT_MS = 3000;

// An EAN-13 is an ISBN only with the 978 or 979 prefix (other prefixes are price or shop codes) and a good check digit.
export function isbn13Valid(code) {
  if (!/^\d{13}$/.test(code)) return false;
  const sum = [...code.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}
export const acceptScan = code => typeof code === "string" && /^97[89]/.test(code) && isbn13Valid(code);

// A GTIN check digit (EAN-8, UPC-A and EAN-13 share it): weights 3 and 1, counted from the right of the body.
const gtinValid = code => {
  const body = code.slice(0, -1), sum = [...body].reduce((total, digit, index) => total + Number(digit) * ((body.length - index) % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(code.at(-1));
};
// What one read means: an ISBN, a price add-on (5 or 2 digits, never a book), a real barcode that is not an ISBN, or noise (a misread).
export function classifyScan(code) {
  if (typeof code !== "string" || !/^\d+$/.test(code)) return "ignore";
  if (code.length === 5 || code.length === 2) return "extension";
  if (![8, 12, 13].includes(code.length) || !gtinValid(code)) return "ignore";
  return acceptScan(code) ? "isbn" : "non_isbn";
}

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

// EAN-13 for ISBNs; the others only so a shop code or a UPC can be told apart from an ISBN and named, not saved.
const READ_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

const loadZxing = async () => {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
  return { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType };
};

// BarcodeDetector exists in some browsers without EAN-13, where it would scan nothing, so it is used only when it says it reads ean_13.
export async function canDetectEan13(env = typeof window === "undefined" ? undefined : window) {
  if (!env || !("BarcodeDetector" in env)) return false;
  try { return (await env.BarcodeDetector.getSupportedFormats()).includes("ean_13"); } catch { return false; }
}

// Starts reading from a playing <video>. BarcodeDetector is used where the browser can read EAN-13 (Android Chrome); otherwise zxing is
// loaded on demand, so it is not part of the main bundle. Returns a stop function. `onCode` gets every EAN-13 value seen.
// `env` and `load` are there so a test can stand in for the browser and for the zxing import.
export async function startDecoder(video, onCode, { env = typeof window === "undefined" ? undefined : window, load = loadZxing } = {}) {
  if (await canDetectEan13(env)) {
    const supported = await env.BarcodeDetector.getSupportedFormats();
    const detector = new env.BarcodeDetector({ formats: READ_FORMATS.filter(format => supported.includes(format)) });
    let stopped = false, timer = 0, busy = false;
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { for (const code of await detector.detect(video)) if (!stopped && classifyScan(code.rawValue) !== "extension") onCode(code.rawValue); } catch { /* a frame that cannot be read is skipped */ }
        busy = false;
      }
      if (!stopped) timer = setTimeout(tick, 150);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }
  const { BrowserMultiFormatReader, BarcodeFormat, DecodeHintType } = await load();
  // The 5-digit price add-on beside many books is allowed (so it cannot confuse the main code), and only the main 13 digits are used.
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]], [DecodeHintType.TRY_HARDER, true], [DecodeHintType.ALLOWED_EAN_EXTENSIONS, [2, 5]]]);
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
  const controls = await reader.decodeFromVideoElement(video, result => { if (result && classifyScan(result.getText()) !== "extension") onCode(result.getText()); });
  return () => controls.stop();
}
