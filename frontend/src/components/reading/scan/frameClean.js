// Cleaning a camera frame before it is decoded: grey, a stretch of the contrast, and every other frame a light sharpen and the inverse.
// Pure functions on pixel arrays, so the phone, a worker and the benchmark all run exactly the same steps.

// RGBA to one grey value per pixel (the usual luma weights).
export function greyscale(rgba, width, height) {
  const grey = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) grey[i] = (rgba[p] * 77 + rgba[p + 1] * 151 + rgba[p + 2] * 28) >> 8;
  return grey;
}

// Stretches the 2nd to 98th percentile of the grey values to the full range. A glare spot or a dark corner is clipped to the ends
// instead of squashing every bar into a narrow band.
export function stretch(grey) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < grey.length; i += 1) counts[grey[i]] += 1;
  const low = Math.floor(grey.length * 0.02), high = Math.floor(grey.length * 0.98);
  let seen = 0, lo = 0, hi = 255;
  for (let value = 0; value < 256; value += 1) { seen += counts[value]; if (seen > low) { lo = value; break; } }
  seen = 0;
  for (let value = 0; value < 256; value += 1) { seen += counts[value]; if (seen >= high) { hi = value; break; } }
  if (hi - lo < 8) return grey;
  const scale = 255 / (hi - lo), out = new Uint8ClampedArray(grey.length);
  for (let i = 0; i < grey.length; i += 1) out[i] = (grey[i] - lo) * scale;
  return out;
}

// A light unsharp mask: the pixel pushed a little away from the mean of its four neighbours. The edges stay put, so thin bars stay thin.
export function sharpen(grey, width, height, amount = 0.6) {
  const out = new Uint8ClampedArray(grey);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x, around = (grey[i - 1] + grey[i + 1] + grey[i - width] + grey[i + width]) / 4;
      out[i] = grey[i] + (grey[i] - around) * amount;
    }
  }
  return out;
}

export const invert = grey => grey.map(value => 255 - value);

// One grey plane back to RGBA, which is what a decoder takes as an image.
export function toRgba(grey) {
  const rgba = new Uint8ClampedArray(grey.length * 4);
  for (let i = 0, p = 0; i < grey.length; i += 1, p += 4) { rgba[p] = rgba[p + 1] = rgba[p + 2] = grey[i]; rgba[p + 3] = 255; }
  return rgba;
}

// Even frames: grey and stretched. Odd frames: the same, sharpened and inverted (a pale bar on a dark band, or a worn bar the sharpen restores).
export function cleanFrame(rgba, width, height, frameNumber) {
  let grey = stretch(greyscale(rgba, width, height));
  if (frameNumber % 2) grey = invert(sharpen(grey, width, height));
  return toRgba(grey);
}
