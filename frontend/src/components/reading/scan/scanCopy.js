// Every word the scan sheet adds for a hard-to-read barcode, in one place (approved by Michael, 21 Nov), and the one-time camera tip's memory.
export const SCAN_COPY = {
  lightOn: "Turn on the light", lightOff: "Turn off the light", zoom: "Zoom",
  notIsbn: "This barcode isn’t an ISBN.",
  notIsbnHelp: "Look for the barcode that starts with 978 or 979. It’s usually on the back cover. Or type the ISBN, which is often printed above the barcode or on the copyright page.",
  type: "Type the ISBN",
  trouble: "Having trouble?",
  tipLight: "Turn on the light.", tipFurther: "Hold the phone a little further away.", tipFlat: "Keep the barcode flat and inside the box.", tipGlare: "Tilt the book a little to get rid of glare.",
  tip: "Tip: you can let Bookvane use your camera without asking each time.",
  tipIphone: "On iPhone, tap aA in the address bar, then Website Settings, then Camera, then Allow.",
  tipAndroid: "On Android, choose “While using the site” when asked.",
  gotIt: "Got it",
  blocked: "Your browser has blocked the camera. Allow it in your browser’s settings for bookvane.me, or type the ISBN.",
};
const TIP_KEY = "bookvane:scan-camera-tip:v1";
export function tipSeen() { try { return localStorage.getItem(TIP_KEY) === "1"; } catch { return false; } }
export function markTipSeen() { try { localStorage.setItem(TIP_KEY, "1"); } catch { /* the tip may show again */ } }
export function platformTip() {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return SCAN_COPY.tipIphone;
  if (/Android/.test(agent)) return SCAN_COPY.tipAndroid;
  return "";
}
