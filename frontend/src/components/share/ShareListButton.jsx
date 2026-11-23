import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "../ui-v2/primitives.jsx";
import { listShareSpec, renderShareImage, shareOrDownload } from "./shareImage.js";

// "Share" on a list page: draws the list as a picture (no notes, dates or counts) and offers it to the share sheet, or downloads it.
export default function ShareListButton({ list, name }) {
  const [state, setState] = useState({ busy: false, failed: false });
  if (!list?.books?.length) return null;
  async function share() {
    setState({ busy: true, failed: false });
    try {
      const blob = await renderShareImage(listShareSpec({ list, name }));
      await shareOrDownload(blob, "bookvane-list.png", { title: list.name });
      setState({ busy: false, failed: false });
    } catch { setState({ busy: false, failed: true }); }
  }
  return <>
    <Button variant="quiet" className="bv-link-button bv-share-list" disabled={state.busy} aria-busy={state.busy || undefined} onClick={share}><Share2 aria-hidden="true" />Share</Button>
    {state.failed && <span className="bv-field-error bv-share-error" role="alert">We couldn’t make the picture. Please try again.</span>}
  </>;
}
