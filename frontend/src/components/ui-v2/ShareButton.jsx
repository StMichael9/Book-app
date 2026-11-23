import { useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "./primitives.jsx";

// The link carries ?ref=share so shares show up in the channel counts. Nothing personal is added to it.
function shareUrl(path) {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("ref", "share");
  return url.toString();
}

const LABELS = { idle: "Share", copied: "Link copied", failed: "Couldn’t copy the link." };

// Opens the system share sheet where there is one; otherwise copies the link and says so for two seconds.
export default function ShareButton({ path, title, text, className = "" }) {
  const [state, setState] = useState("idle");
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  function flash(next) {
    setState(next); clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }
  async function copy(url) {
    try { await navigator.clipboard.writeText(url); flash("copied"); } catch { flash("failed"); }
  }
  async function share() {
    const url = shareUrl(path);
    if (typeof navigator.share === "function") {
      try { await navigator.share({ title, text, url }); } catch (error) { if (error?.name !== "AbortError") await copy(url); }
      return;
    }
    await copy(url);
  }
  return <Button variant="quiet" className={`bv-share ${className}`.trim()} onClick={share}>
    <Share2 aria-hidden="true" size={18} strokeWidth={2} /><span>{LABELS[state]}</span>
    <span className="bv-sr-only" role="status" aria-live="polite">{state === "idle" ? "" : LABELS[state]}</span></Button>;
}
