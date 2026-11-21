// "No grey panel behind a cover": for every cover (a .bv-cover frame, a profile art slot, a scan blank, a skeleton cover) report any element
// that wraps the cover art and paints a background: the frame and its picture may paint none at all, and the two ancestors above it (a card, a row)
// may paint their own surface but never the soft grey-brown fill.
// Returns the offenders as short descriptions; an empty list is a pass.
export const greyBehindCovers = page => page.evaluate(() => {
  const clear = value => value === "rgba(0, 0, 0, 0)" || value === "transparent";
  const stop = node => !node || node === document.body || node === document.documentElement || node.matches("main, dialog, .bv-root, #root");
  const probe = document.createElement("span"); probe.style.color = "var(--bv-soft)"; document.querySelector(".bv-root").append(probe);
  const soft = getComputedStyle(probe).color; probe.remove();
  const roots = [...document.querySelectorAll(".bv-cover, .bv-art-slot, .bv-scan-cover-blank, .bv-skeleton--cover, .bv-suggest-cover")];
  const seen = new Set(), offenders = [];
  for (const root of roots) {
    const chain = [root, ...root.querySelectorAll("img")], own = new Set(chain);
    let up = root.parentElement;
    for (let step = 0; step < 2 && !stop(up); step += 1, up = up.parentElement) chain.push(up);
    for (const node of chain) {
      if (seen.has(node)) continue; seen.add(node);
      if (node.matches(".bv-jacket, .bv-jacket *, .bv-art-spine, .bv-art-spine *")) continue;   // the designed jacket and cloth keep their own colours
      const bg = getComputedStyle(node).backgroundColor;
      if (own.has(node) ? !clear(bg) : bg === soft) offenders.push(`${node.tagName.toLowerCase()}.${String(node.className).split(" ").join(".")} ${bg}`);
    }
  }
  return offenders;
});
