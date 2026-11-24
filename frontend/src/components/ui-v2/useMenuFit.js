import { useLayoutEffect } from "react";

// The phone menu shows an icon and a word. Where the five whole words cannot fit the menu's width at the current text size, the WHOLE menu
// switches to icons only (CSS: [data-icons]; the labels stay for screen readers).
//
// This is measured on the real menu, and always as if the labels were showing: each check takes icons-only off, sizes every column to its
// longest word (grid-auto-columns: min-content), adds up the columns and the gaps, and compares the sum with the room inside the menu. The
// answer depends only on the width and the text, never on the mode the menu is in, so the mode cannot flip back and forth. Words must fit with
// 2px to spare. All of it happens in one synchronous pass, so the reader never sees the in-between state.
//
// It runs in a layout effect (the first paint is already right) and again whenever anything that changes widths changes: the menu's own size,
// the window, a web font arriving, and the text size (a probe 1rem wide inside the menu changes size with the root font size, which a resize
// observer on the menu alone would miss).
const SPARE = 2;

export function useMenuFit(ref, deps) {
  useLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const check = () => {
      nav.removeAttribute("data-icons");
      if (!nav.clientWidth) return; // not shown (a wide screen)
      nav.style.gridAutoColumns = "min-content";
      const style = getComputedStyle(nav), links = [...nav.children].filter(node => node.tagName === "A");
      const room = nav.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const need = links.reduce((sum, link) => sum + link.getBoundingClientRect().width, 0) + (parseFloat(style.columnGap) || 0) * Math.max(0, links.length - 1);
      nav.style.gridAutoColumns = "";
      if (need > room - SPARE) nav.setAttribute("data-icons", "");
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(nav);
    const probe = nav.querySelector(".bv-nav-probe");
    if (probe) observer.observe(probe);
    window.addEventListener("resize", check);
    const fonts = document.fonts;
    fonts?.addEventListener?.("loadingdone", check);
    fonts?.ready?.then(check);
    return () => { observer.disconnect(); window.removeEventListener("resize", check); fonts?.removeEventListener?.("loadingdone", check); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
