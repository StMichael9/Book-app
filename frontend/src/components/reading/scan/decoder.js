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
const FRAME_MS = 150, MAX_FRAME_WIDTH = 1000;

// An ISBN counts only when the same checksum-valid code is read twice within a second and a half: one misread frame never adds a book.
export function createConfirmGate(windowMs = 1500, now = () => Date.now()) {
  const last = new Map();
  return code => {
    const time = now(), seen = last.get(code);
    last.set(code, time);
    return seen !== undefined && time - seen <= windowMs;
  };
}

const loadWasmEngine = async () => (await import("./wasmEngine.js")).createWasmEngine();

// BarcodeDetector exists in some browsers without EAN-13, where it would scan nothing, so it is used only when it says it reads ean_13.
export async function canDetectEan13(env = typeof window === "undefined" ? undefined : window) {
  if (!env || !("BarcodeDetector" in env)) return false;
  try { return (await env.BarcodeDetector.getSupportedFormats()).includes("ean_13"); } catch { return false; }
}

// Where the aiming box sits in the camera's own pixels. The video fills its box edge to edge (object-fit: cover), so the picture is
// scaled up and trimmed; the box is mapped back through that, then padded a little. Null means "use the whole frame".
export function aimRegion(video, aim, pad = 0.12) {
  if (!video?.videoWidth || !video.videoHeight || !aim) return null;
  const view = video.getBoundingClientRect(), box = aim.getBoundingClientRect();
  if (!view.width || !view.height || !box.width) return null;
  const scale = Math.max(view.width / video.videoWidth, view.height / video.videoHeight);
  const shiftX = (video.videoWidth * scale - view.width) / 2, shiftY = (video.videoHeight * scale - view.height) / 2;
  const padX = box.width * pad, padY = box.height * pad;
  const left = Math.max(0, (box.left - view.left - padX + shiftX) / scale), top = Math.max(0, (box.top - view.top - padY + shiftY) / scale);
  const right = Math.min(video.videoWidth, (box.right - view.left + padX + shiftX) / scale), bottom = Math.min(video.videoHeight, (box.bottom - view.top + padY + shiftY) / scale);
  if (right - left < 40 || bottom - top < 20) return null;
  return { sx: left, sy: top, sw: right - left, sh: bottom - top };
}

// The pixels of the aiming region (or the whole frame), at most 1000 wide: all the decoder needs, and fast to send to the worker.
export function grabFrame(video, region) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const area = region || { sx: 0, sy: 0, sw: vw, sh: vh }, scale = Math.min(1, MAX_FRAME_WIDTH / area.sw);
  const width = Math.max(1, Math.round(area.sw * scale)), height = Math.max(1, Math.round(area.sh * scale));
  const canvas = typeof OffscreenCanvas === "undefined" ? Object.assign(document.createElement("canvas"), { width, height }) : new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(video, area.sx, area.sy, area.sw, area.sh, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  return { data, width, height };
}

// Starts reading from a playing <video>. BarcodeDetector is used where the browser can read EAN-13 (Android Chrome); everywhere else the
// built-in reader (ZXing-C++ as WebAssembly, in a worker) is loaded on demand, so it is not part of the main bundle. Returns a stop
// function. `onCode` gets every code worth looking at: an ISBN only once confirmed by a second identical read, and never a price add-on.
// `env`, `loadEngine`, `grab`, `now` and `onEngine` are there so a test can stand in for the browser, the worker and the clock.
export async function startDecoder(video, onCode, { env = typeof window === "undefined" ? undefined : window, loadEngine = loadWasmEngine, getRegion = () => null, grab = grabFrame, now = () => Date.now(), onEngine = () => {} } = {}) {
  const gate = createConfirmGate(1500, now);
  const emit = code => {
    const kind = classifyScan(code);
    if (kind === "extension" || kind === "ignore") return;
    if (kind === "isbn" && !gate(code)) return;
    onCode(code);
  };
  if (await canDetectEan13(env)) {
    const supported = await env.BarcodeDetector.getSupportedFormats();
    const detector = new env.BarcodeDetector({ formats: READ_FORMATS.filter(format => supported.includes(format)) });
    let stopped = false, timer = 0, busy = false;
    onEngine("native");
    const tick = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2) {
        busy = true;
        try { for (const code of await detector.detect(video)) if (!stopped) emit(code.rawValue); } catch { /* a frame that cannot be read is skipped */ }
        busy = false;
      }
      if (!stopped) timer = setTimeout(tick, FRAME_MS);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }
  const engine = await loadEngine();
  let stopped = false, timer = 0, busy = false, frame = 0;
  onEngine("wasm");
  const tick = async () => {
    if (stopped) return;
    if (!busy && video.readyState >= 2) {
      busy = true;
      try {
        const pixels = grab(video, getRegion());
        if (pixels) for (const code of await engine.read(pixels, frame++)) if (!stopped) emit(code);
      } catch { /* a frame that cannot be read is skipped */ }
      busy = false;
    }
    if (!stopped) timer = setTimeout(tick, FRAME_MS);
  };
  tick();
  return () => { stopped = true; clearTimeout(timer); engine.stop?.(); };
}
