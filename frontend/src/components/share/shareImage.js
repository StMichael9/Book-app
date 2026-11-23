// A small canvas helper for share pictures: a layout spec in, a PNG blob out, plus a share-or-download step.
// Lists use it first (listShareSpec); a book share can reuse it later with a spec of its own.
// The picture is always drawn in the light palette, whatever theme the reader is in, so it looks the same wherever it is posted.
import { coverSrc } from "../../api/coverUrl.js";

export const SHARE_WIDTH = 1080;
export const SHARE_HEIGHT = 1350;
export const MAX_SHARE_BOOKS = 5;

const PALETTE = { paper: "#f3eee3", ink: "#1f2a24", muted: "#5d665f", line: "#e2dccd", green: "#28513f", onGreen: "#fffdf5", soft: "#e6e9dd", rustTint: "#e8d8cb", rust: "#9c432d" };
const TONES = [{ bg: PALETTE.soft, ink: PALETTE.green }, { bg: PALETTE.soft, ink: PALETTE.ink }, { bg: PALETTE.rustTint, ink: PALETTE.rust }, { bg: PALETTE.green, ink: PALETTE.onGreen }, { bg: PALETTE.ink, ink: PALETTE.paper }];
// The same stable tint per title the app's own jackets use.
const toneFor = (title = "") => { let hash = 0; for (const character of title) hash = (hash * 31 + character.codePointAt(0)) >>> 0; return TONES[hash % TONES.length]; };

const MARGIN = 80;

// What a list share shows: who made it, its title, up to five covers in list order, and the numbered titles with their authors.
// Nothing else: no notes, reactions, dates, counts or reading state ever reach this spec.
const authorNames = book => (Array.isArray(book?.authors) ? book.authors : []).map(author => typeof author === "string" ? author : author?.name).filter(Boolean);

export function listShareSpec({ list, name }) {
  const books = (Array.isArray(list?.books) ? list.books : []).slice(0, MAX_SHARE_BOOKS).map(book => ({ title: book.title, cover_image_url: book.cover_image_url, authors: authorNames(book) }));
  const ops = [];
  if (name) ops.push({ type: "text", text: `A list by ${name}`, font: "body", size: 28, weight: 600, color: PALETTE.muted, x: MARGIN, y: 120, maxWidth: SHARE_WIDTH - 2 * MARGIN });
  ops.push({ type: "text", text: list?.name || "", font: "display", size: 96, minSize: 60, color: PALETTE.ink, x: MARGIN, y: 238, maxWidth: SHARE_WIDTH - 2 * MARGIN });
  const gap = 20, width = (SHARE_WIDTH - 2 * MARGIN - gap * (MAX_SHARE_BOOKS - 1)) / MAX_SHARE_BOOKS, height = Math.round(width * 1.5);
  books.forEach((book, index) => ops.push({ type: "cover", x: Math.round(MARGIN + index * (width + gap)), y: 270, w: Math.round(width), h: height, src: book.cover_image_url ? coverSrc(book.cover_image_url, "medium") : null, title: book.title || "", author: (book.authors || []).join(", ") }));
  const top = 270 + height + 60;
  books.forEach((book, index) => {
    const y = top + index * 97;
    ops.push({ type: "text", text: String(index + 1), font: "display", size: 36, color: PALETTE.muted, x: MARGIN, y: y + 36 });
    ops.push({ type: "text", text: book.title || "Untitled book", font: "body", size: 36, color: PALETTE.ink, x: 136, y: y + 36, maxWidth: SHARE_WIDTH - 136 - MARGIN, ellipsis: true });
    if (book.authors?.length) ops.push({ type: "text", text: book.authors.join(", "), font: "body", size: 26, color: PALETTE.muted, x: 136, y: y + 70, maxWidth: SHARE_WIDTH - 136 - MARGIN, ellipsis: true });
  });
  ops.push({ type: "line", x1: MARGIN, x2: SHARE_WIDTH - MARGIN, y: 1180, color: PALETTE.line, width: 2 });
  ops.push({ type: "text", text: "Made with Bookvane", font: "display", size: 40, color: PALETTE.ink, x: MARGIN, y: 1252 });
  ops.push({ type: "text", text: "bookvane.me", font: "body", size: 30, color: PALETTE.muted, x: SHARE_WIDTH - MARGIN, y: 1252, align: "right" });
  return { width: SHARE_WIDTH, height: SHARE_HEIGHT, background: PALETTE.paper, ops };
}

// A picture the canvas may draw without tainting it: requested with CORS, and `null` when it can't be had (so the jacket is drawn instead).
export function loadShareImage(src, timeout = 8000) {
  if (!src) return Promise.resolve(null);
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => resolve(null), timeout);
    image.crossOrigin = "anonymous";
    image.onload = () => { clearTimeout(timer); resolve(image.naturalWidth > 0 ? image : null); };
    image.onerror = () => { clearTimeout(timer); resolve(null); };
    image.src = src;
  });
}

function families() {
  const style = typeof document === "undefined" ? null : getComputedStyle(document.querySelector(".bv-root") || document.documentElement);   // the fonts are tokens on the app root
  return { display: style?.getPropertyValue("--bv-display").trim() || "Georgia, serif", body: style?.getPropertyValue("--bv-body").trim() || "Segoe UI, sans-serif" };
}

async function ready(fonts) {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  try { await Promise.all([document.fonts.load(`400 40px ${fonts.display}`), document.fonts.load(`400 30px ${fonts.body}`), document.fonts.load(`600 30px ${fonts.body}`)]); } catch { /* the page's own fonts, or the fallbacks, are good enough */ }
}

const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); };

function fitText(ctx, op, fonts) {
  let size = op.size;
  const set = () => { ctx.font = `${op.weight || 400} ${size}px ${fonts[op.font] || fonts.body}`; };
  set();
  while (op.minSize && op.maxWidth && ctx.measureText(op.text).width > op.maxWidth && size > op.minSize) { size -= 2; set(); }
  let text = op.text;
  if (op.maxWidth && op.ellipsis !== false) {
    while (text.length > 1 && ctx.measureText(text).width > op.maxWidth) text = text.slice(0, -1);
    if (text !== op.text) text = `${text.trimEnd()}…`;
  }
  return text;
}

function wrap(ctx, text, maxWidth) {
  const lines = []; let line = "";
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCover(ctx, op, image, fonts) {
  ctx.save();
  ctx.shadowColor = "rgba(31, 42, 36, 0.28)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
  roundRect(ctx, op.x, op.y, op.w, op.h, 4); ctx.fillStyle = PALETTE.soft; ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, op.x, op.y, op.w, op.h, 4); ctx.clip();
  if (image) {
    // Fill the frame from the top, cropping the sides or the bottom, never stretching.
    const scale = Math.max(op.w / image.naturalWidth, op.h / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
    ctx.drawImage(image, op.x + (op.w - w) / 2, op.y, w, h);
  } else {
    // The jacket: a tinted cover with the title and author, like the app's own.
    const tone = toneFor(op.title);
    ctx.fillStyle = tone.bg; ctx.fillRect(op.x, op.y, op.w, op.h);
    ctx.fillStyle = tone.ink; ctx.globalAlpha = 0.25; ctx.fillRect(op.x + op.w * 0.075, op.y, 2, op.h); ctx.globalAlpha = 1;
    ctx.font = `400 ${Math.round(op.w * 0.12)}px ${fonts.display}`; ctx.textBaseline = "alphabetic";
    const lineHeight = Math.round(op.w * 0.15), pad = op.w * 0.16;
    wrap(ctx, op.title || "Untitled book", op.w - pad - op.w * 0.1).slice(0, 5).forEach((line, index) => ctx.fillText(line, op.x + pad, op.y + op.h * 0.13 + op.w * 0.12 + index * lineHeight));
    ctx.font = `600 ${Math.round(op.w * 0.065)}px ${fonts.body}`;
    ctx.fillText(String(op.author || "").toUpperCase().slice(0, 22), op.x + pad, op.y + op.h - op.w * 0.1);
  }
  ctx.restore();
}

// Draws the spec and returns the PNG as a Blob. `images` (optional) maps a cover's src to an already-loaded image, for tests.
export async function renderShareImage(spec, { load = loadShareImage, document: doc = typeof document === "undefined" ? null : document } = {}) {
  if (!doc) throw new Error("A document is needed to draw the picture");
  const fonts = families();
  await ready(fonts);
  const canvas = doc.createElement("canvas");
  canvas.width = spec.width; canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = spec.background; ctx.fillRect(0, 0, spec.width, spec.height);
  const images = await Promise.all(spec.ops.map(op => op.type === "cover" ? load(op.src) : null));
  spec.ops.forEach((op, index) => {
    if (op.type === "text") {
      ctx.save(); ctx.fillStyle = op.color; ctx.textAlign = op.align || "left"; ctx.textBaseline = "alphabetic";
      const text = fitText(ctx, op, fonts); ctx.fillText(text, op.x, op.y); ctx.restore();
    } else if (op.type === "line") {
      ctx.save(); ctx.strokeStyle = op.color; ctx.lineWidth = op.width || 1; ctx.beginPath(); ctx.moveTo(op.x1, op.y); ctx.lineTo(op.x2, op.y); ctx.stroke(); ctx.restore();
    } else if (op.type === "cover") drawCover(ctx, op, images[index], fonts);
  });
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("The picture couldn't be made")), "image/png"));
}

// Offers the picture to the device's share sheet where files can be shared, and otherwise downloads it.
// Returns "shared", "cancelled" or "downloaded".
export async function shareOrDownload(blob, filename, { title } = {}) {
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], ...(title ? { title } : {}) }); return "shared"; }
    catch (error) { if (error?.name === "AbortError") return "cancelled"; /* any other failure: fall back to a download */ }
  }
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
