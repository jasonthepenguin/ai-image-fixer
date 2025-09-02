// Basic client-side image processing utilities
// - Auto white balance (gray-world)
// - Gaussian noise
// - Gaussian blur (separable kernel)
// - Color adjustments: brightness, contrast, saturation

export type Adjustments = {
  autoWhiteBalance: boolean;
  noiseSigma: number; // 0..50
  blurPx: number; // 0..10
  brightness: number; // -100..100 (%)
  contrast: number; // -100..100 (%)
  saturation: number; // -100..100 (%)
};

export function clamp(v: number, min = 0, max = 255): number {
  return v < min ? min : v > max ? max : v;
}

// GIMP-like auto white balance via per-channel auto levels with percentile clipping
// We compute low/high per channel at clipPct (e.g., 0.5%) and remap linearly.
export function applyAutoWhiteBalance(data: ImageData, clipPct = 0.005): ImageData {
  const { data: buf, width, height } = data;
  const n = width * height;
  if (n === 0) return data;

  // Build histograms per channel
  const hr = new Uint32Array(256);
  const hg = new Uint32Array(256);
  const hb = new Uint32Array(256);
  for (let i = 0; i < buf.length; i += 4) {
    hr[buf[i]]++;
    hg[buf[i + 1]]++;
    hb[buf[i + 2]]++;
  }

  const clipN = Math.max(0, Math.min(n - 1, Math.round(n * clipPct)));

  function lowHigh(hist: Uint32Array): [number, number] {
    let lo = 0, hi = 255;
    // low
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (acc > clipN) { lo = v; break; }
    }
    // high
    acc = 0;
    for (let v = 255; v >= 0; v--) {
      acc += hist[v];
      if (acc > clipN) { hi = v; break; }
    }
    if (hi <= lo) { lo = 0; hi = 255; }
    return [lo, hi];
  }

  const [rLo, rHi] = lowHigh(hr);
  const [gLo, gHi] = lowHigh(hg);
  const [bLo, bHi] = lowHigh(hb);

  // Precompute LUTs
  function makeLut(lo: number, hi: number): Uint8ClampedArray {
    const lut = new Uint8ClampedArray(256);
    const range = hi - lo || 1;
    for (let v = 0; v < 256; v++) {
      const t = ((v - lo) / range) * 255;
      lut[v] = t < 0 ? 0 : t > 255 ? 255 : t;
    }
    return lut;
  }
  const lr = makeLut(rLo, rHi);
  const lg = makeLut(gLo, gHi);
  const lb = makeLut(bLo, bHi);

  const out = new ImageData(width, height);
  const dst = out.data;
  for (let i = 0; i < buf.length; i += 4) {
    dst[i] = lr[buf[i]];
    dst[i + 1] = lg[buf[i + 1]];
    dst[i + 2] = lb[buf[i + 2]];
    dst[i + 3] = buf[i + 3];
  }
  return out;
}

// Box-Muller transform for gaussian noise
function gaussianRandom(mean = 0, stdDev = 1): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const mag = Math.sqrt(-2.0 * Math.log(u));
  const z0 = mag * Math.cos(2.0 * Math.PI * v);
  return z0 * stdDev + mean;
}

export function applyGaussianNoise(data: ImageData, sigma: number): ImageData {
  if (sigma <= 0) return data;
  const out = new ImageData(data.width, data.height);
  const src = data.data; const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = clamp(src[i] + gaussianRandom(0, sigma));
    dst[i + 1] = clamp(src[i + 1] + gaussianRandom(0, sigma));
    dst[i + 2] = clamp(src[i + 2] + gaussianRandom(0, sigma));
    dst[i + 3] = src[i + 3];
  }
  return out;
}

// Color adjustments
export function applyBrightnessContrast(data: ImageData, brightnessPct: number, contrastPct: number): ImageData {
  // brightness in [-100,100] -> add term b (0..255)
  // contrast in [-100,100] -> factor f
  const b = (brightnessPct / 100) * 255;
  const c = contrastPct / 100;
  const f = (259 * (c + 1)) / (255 * (1 - c)); // standard contrast formula
  const out = new ImageData(data.width, data.height);
  const src = data.data; const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    dst[i] = clamp(f * (src[i] - 128) + 128 + b);
    dst[i + 1] = clamp(f * (src[i + 1] - 128) + 128 + b);
    dst[i + 2] = clamp(f * (src[i + 2] - 128) + 128 + b);
    dst[i + 3] = src[i + 3];
  }
  return out;
}

// HSL conversion helpers
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max - min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l; // achromatic
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

export function applySaturation(data: ImageData, saturationPct: number): ImageData {
  if (saturationPct === 0) return data;
  const factor = 1 + saturationPct / 100; // >1 more saturated, <1 desaturated
  const out = new ImageData(data.width, data.height);
  const src = data.data; const dst = out.data;
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    let [h, s, l] = rgbToHsl(r, g, b);
    s = Math.max(0, Math.min(1, s * factor));
    const [nr, ng, nb] = hslToRgb(h, s, l);
    dst[i] = clamp(nr);
    dst[i + 1] = clamp(ng);
    dst[i + 2] = clamp(nb);
    dst[i + 3] = src[i + 3];
  }
  return out;
}

// Gaussian blur via separable convolution
function makeGaussianKernel(sigma: number): { kernel: Float32Array; radius: number } {
  if (sigma <= 0.1) return { kernel: new Float32Array([1]), radius: 0 };
  const radius = Math.max(1, Math.min(20, Math.ceil(sigma * 3)));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  const sigma2 = sigma * sigma;
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma2));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return { kernel, radius };
}

export function applyGaussianBlur(data: ImageData, sigmaPx: number): ImageData {
  if (sigmaPx <= 0.1) return data;
  const { kernel, radius } = makeGaussianKernel(sigmaPx);
  const w = data.width, h = data.height;
  const src = data.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        const idx = (y * w + xx) * 4;
        const kv = kernel[k + radius];
        r += src[idx] * kv;
        g += src[idx + 1] * kv;
        b += src[idx + 2] * kv;
        a += src[idx + 3] * kv;
      }
      const di = (y * w + x) * 4;
      tmp[di] = r;
      tmp[di + 1] = g;
      tmp[di + 2] = b;
      tmp[di + 3] = a;
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        const idx = (yy * w + x) * 4;
        const kv = kernel[k + radius];
        r += tmp[idx] * kv;
        g += tmp[idx + 1] * kv;
        b += tmp[idx + 2] * kv;
        a += tmp[idx + 3] * kv;
      }
      const di = (y * w + x) * 4;
      out[di] = r;
      out[di + 1] = g;
      out[di + 2] = b;
      out[di + 3] = a;
    }
  }

  return new ImageData(out, w, h);
}

export function applyPipeline(input: ImageData, adj: Adjustments): ImageData {
  let img = input;
  if (adj.autoWhiteBalance) img = applyAutoWhiteBalance(img);
  if (adj.noiseSigma > 0) img = applyGaussianNoise(img, adj.noiseSigma);
  if (adj.brightness !== 0 || adj.contrast !== 0) img = applyBrightnessContrast(img, adj.brightness, adj.contrast);
  if (adj.saturation !== 0) img = applySaturation(img, adj.saturation);
  if (adj.blurPx > 0) img = applyGaussianBlur(img, adj.blurPx);
  return img;
}
