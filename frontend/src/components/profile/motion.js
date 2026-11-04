// One short acknowledgement for a state change; nothing moves for a reader who asked for reduced motion.
export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function animateRow(element, keyframes, duration, options = {}) {
  if (!element?.animate || reducedMotion()) return Promise.resolve();
  const previous = element.style.overflow;
  element.style.overflow = "hidden";
  const animation = element.animate(keyframes, { duration, easing: "ease-out", ...options });
  return animation.finished.then(() => undefined, () => undefined).finally(() => { element.style.overflow = previous; });
}

export const collapse = element => animateRow(element, [{ maxHeight: `${element.offsetHeight}px`, opacity: 1 }, { maxHeight: "0px", opacity: 0, paddingTop: 0, paddingBottom: 0, borderTopWidth: 0 }], 200, { easing: "ease-in", fill: "forwards" });
export const expand = element => animateRow(element, [{ maxHeight: "0px", opacity: 0 }, { maxHeight: `${element.offsetHeight}px`, opacity: 1 }], 200);
export const slideFrom = (element, distance) => animateRow(element, [{ transform: `translateY(${distance}px)` }, { transform: "none" }], 160);
