import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "./primitives.jsx";

// Long text that starts at a few lines. "Show more" appears only when the clamp actually hides text; ResizeObserver reports
// once on observe, then on every width change. Used for book descriptions on the book page and in My Books.
export default function ClampedText({ text, lines = 2, className = "" }) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const paragraph = useRef(null);
  const id = useId();
  useLayoutEffect(() => {
    const node = paragraph.current;
    if (!node || expanded) return undefined;
    const observer = new ResizeObserver(() => setClipped(node.scrollHeight > node.clientHeight + 1));
    observer.observe(node);
    return () => observer.disconnect();
  }, [text, expanded, lines]);
  const clamp = expanded ? undefined : { display: "-webkit-box", WebkitLineClamp: lines, lineClamp: lines, WebkitBoxOrient: "vertical", overflow: "hidden" };
  return <>
    <p ref={paragraph} id={id} className={className} style={clamp}>{text}</p>
    {(clipped || expanded) && <Button variant="quiet" className="bv-synopsis-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show more"}</Button>}
  </>;
}
