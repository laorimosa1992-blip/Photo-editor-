// Чистая пиксельная обработка (без DOM), чтобы её можно было тестировать отдельно.

export const isIdentity = p =>
  !p.brightness && !p.contrast && !p.saturation && !p.blur && !p.sharpen && p.preset === 'none';

// Быстрое размытие рамкой (бегущая сумма), одна проходка по горизонтали и вертикали.
export function boxBlur(src, w, h, r) {
  if (r < 1) return src;
  const div = 2 * r + 1;
  const sw = w * 4;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  for (let y = 0; y < h; y++) {
    const row = y * sw;
    for (let ch = 0; ch < 4; ch++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i)) * 4 + ch];
      for (let x = 0; x < w; x++) {
        tmp[row + x * 4 + ch] = sum / div;
        sum += src[row + Math.min(w - 1, x + r + 1) * 4 + ch] - src[row + Math.max(0, x - r) * 4 + ch];
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let ch = 0; ch < 4; ch++) {
      const col = x * 4 + ch;
      let sum = 0;
      for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * sw + col];
      for (let y = 0; y < h; y++) {
        out[y * sw + col] = sum / div;
        sum += tmp[Math.min(h - 1, y + r + 1) * sw + col] - tmp[Math.max(0, y - r) * sw + col];
      }
    }
  }
  return out;
}

// d — RGBA Uint8ClampedArray. Возвращает обработанный массив.
export function adjustPixels(d, w, h, p) {
  const colorNeeded = p.brightness || p.contrast || p.saturation || p.preset !== 'none';
  if (colorNeeded) {
    const br = p.brightness * 2.55;
    const cc = p.contrast * 1.6;
    const cf = (259 * (cc + 255)) / (255 * (259 - cc));
    const sat = 1 + p.saturation / 100;
    const pre = p.preset;
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i] + br, g = d[i + 1] + br, b = d[i + 2] + br;
      r = cf * (r - 128) + 128;
      g = cf * (g - 128) + 128;
      b = cf * (b - 128) + 128;
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      r = gray + (r - gray) * sat;
      g = gray + (g - gray) * sat;
      b = gray + (b - gray) * sat;
      switch (pre) {
        case 'bw': {
          const y = 0.299 * r + 0.587 * g + 0.114 * b;
          r = g = b = y;
          break;
        }
        case 'sepia': {
          const nr = 0.393 * r + 0.769 * g + 0.189 * b;
          const ng = 0.349 * r + 0.686 * g + 0.168 * b;
          const nb = 0.272 * r + 0.534 * g + 0.131 * b;
          r = nr; g = ng; b = nb;
          break;
        }
        case 'invert': r = 255 - r; g = 255 - g; b = 255 - b; break;
        case 'warm': r *= 1.08; b *= 0.9; break;
        case 'cool': r *= 0.9; b *= 1.1; break;
        case 'fade': r = r * 0.85 + 30; g = g * 0.85 + 30; b = b * 0.85 + 36; break;
        default: break;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }

  if (p.blur > 0) {
    const r = Math.max(1, Math.round((p.blur / 100) * 0.012 * Math.max(w, h)));
    d = boxBlur(boxBlur(d, w, h, r), w, h, r);
  }

  if (p.sharpen > 0) {
    const r = Math.max(1, Math.round(Math.max(w, h) / 900));
    const bl = boxBlur(d, w, h, r);
    const a = (p.sharpen / 100) * 1.6;
    const out = new Uint8ClampedArray(d.length);
    for (let i = 0; i < d.length; i += 4) {
      out[i] = d[i] + a * (d[i] - bl[i]);
      out[i + 1] = d[i + 1] + a * (d[i + 1] - bl[i + 1]);
      out[i + 2] = d[i + 2] + a * (d[i + 2] - bl[i + 2]);
      out[i + 3] = d[i + 3];
    }
    d = out;
  }
  return d;
}
