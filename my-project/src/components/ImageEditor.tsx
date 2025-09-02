import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Adjustments } from '../lib/imageOps';
import { applyPipeline } from '../lib/imageOps';

const defaultAdj: Adjustments = {
  autoWhiteBalance: false,
  autoColorEnhance: false,
  noiseSigma: 0,
  blurPx: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
};

function useDebounced<T>(value: T, delay = 80) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function ImageEditor() {
  const [imageURL, setImageURL] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [adj, setAdj] = useState<Adjustments>(defaultAdj);
  const dAdj = useDebounced(adj, 60);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement | null>(null); // stores original (possibly downscaled)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);
  const [working, setWorking] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Zoom state and container ref for fit-to-view calculations
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [fitZoom, setFitZoom] = useState<number>(1);
  const [autoFit, setAutoFit] = useState<boolean>(true);

  const clampZoom = useCallback((z: number) => Math.min(8, Math.max(0.1, z)), []);

  // Load image into offscreen canvas
  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setImageURL(url);
    setFileName(file.name);
    setAutoFit(true);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer.files?.[0];
    if (f) loadImage(f);
  }, [loadImage]);

  const onInputFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) loadImage(f);
  }, [loadImage]);

  const reset = useCallback(() => {
    setImageURL(null);
    setFileName(null);
    setAdj(defaultAdj);
    setImgDims(null);
    setZoom(1);
    setFitZoom(1);
    setAutoFit(true);
  }, []);

  const copyToClipboard = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Failed generating image blob');
      const ClipboardItemCtor = (window as any).ClipboardItem;
      if (!navigator.clipboard || !ClipboardItemCtor) throw new Error('Image clipboard not supported');
      const item = new ClipboardItemCtor({ [blob.type]: blob });
      await navigator.clipboard.write([item]);
      setActionMsg('Copied image to clipboard');
    } catch (e: any) {
      setActionMsg(e?.message ? `Copy failed: ${e.message}` : 'Copy failed');
    } finally {
      setTimeout(() => setActionMsg(null), 2000);
    }
  }, []);

  const downloadImage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    const base = fileName ? fileName.replace(/\.[^.]+$/, '') : 'image';
    link.download = `${base}-enhanced.png`;
    link.href = canvas.toDataURL('image/png');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [fileName]);

  // Draw the source image to an offscreen canvas (downscale if large)
  useEffect(() => {
    if (!imageURL) return;
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600; // limit for performance
      let w = img.width;
      let h = img.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      if (scale < 1) {
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      let srcCanvas = srcCanvasRef.current;
      if (!srcCanvas) {
        srcCanvas = document.createElement('canvas');
        srcCanvasRef.current = srcCanvas;
      }
      srcCanvas.width = w;
      srcCanvas.height = h;
      const ctx = srcCanvas.getContext('2d')!;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      setImgDims({ w, h });
      // initial paint to visible canvas
      const vis = canvasRef.current;
      if (vis) {
        vis.width = w;
        vis.height = h;
        const vctx = vis.getContext('2d')!;
        vctx.clearRect(0, 0, w, h);
        vctx.drawImage(srcCanvas, 0, 0);
      }
      URL.revokeObjectURL(imageURL);
    };
    img.src = imageURL;
  }, [imageURL]);

  // Recompute when adjustments change
  useEffect(() => {
    if (!srcCanvasRef.current || !imgDims) return;
    const { w, h } = imgDims;
    const srcCtx = srcCanvasRef.current.getContext('2d')!;
    const base = srcCtx.getImageData(0, 0, w, h);
    setWorking(true);
    // Offload heavy work to next tick
    requestAnimationFrame(() => {
      try {
        const processed = applyPipeline(base, dAdj);
        const vis = canvasRef.current;
        if (vis) {
          vis.width = w; vis.height = h;
          const vctx = vis.getContext('2d')!;
          vctx.putImageData(processed, 0, 0);
        }
      } finally {
        setWorking(false);
      }
    });
  }, [dAdj, imgDims]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasImage = useMemo(() => !!imgDims, [imgDims]);

  // Compute fit-to-container zoom whenever dimensions or container size change
  useEffect(() => {
    if (!hasImage || !imgDims) return;
    const calcFit = () => {
      const el = containerRef.current;
      if (!el) return;
      const { clientWidth, clientHeight } = el;
      const z = Math.min(clientWidth / imgDims.w, clientHeight / imgDims.h, 1);
      setFitZoom(z);
      if (autoFit) setZoom(z);
    };
    calcFit();
    const onResize = () => calcFit();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [hasImage, imgDims, autoFit]);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center">
      <div className="mx-auto max-w-6xl p-4 w-full">
        <h1 className="text-2xl font-semibold mb-6 text-center">Jason's Image Gen Fixer</h1>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-8">
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              ref={containerRef}
              className={`bg-white rounded-lg shadow p-3 overflow-auto min-h-[300px] relative ${hasImage ? 'flex items-start justify-start' : 'flex items-center justify-center'}`}
            >
              {hasImage ? (
                <div
                  className="shrink-0"
                  style={{ width: imgDims ? `${imgDims.w * zoom}px` : undefined, height: imgDims ? `${imgDims.h * zoom}px` : undefined }}
                >
                  <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
                </div>
              ) : (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-10 w-full h-full flex flex-col items-center justify-center hover:border-blue-400 transition-colors">
                  <p className="mb-3">Drag and drop an image here</p>
                  <button
                    className="px-3 py-2 rounded bg-blue-600 text-white"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Browse Files
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onInputFile} />
                </div>
              )}
            </div>
          </div>
          <div className="md:col-span-4">
            <div className="bg-white rounded-lg shadow p-4 space-y-4">
              <div className="flex flex-col gap-1">
                <div className="truncate min-w-0">
                  <p className="font-medium">{fileName ?? 'No image loaded'}</p>
                  <p className="text-xs text-gray-500">{hasImage ? `${imgDims?.w}×${imgDims?.h}px` : 'Drop or browse an image'}</p>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Zoom</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
                      onClick={() => { setAutoFit(false); setZoom(z => clampZoom(z - 0.1)); }}
                      title="Zoom out"
                      disabled={!hasImage}
                    >
                      −
                    </button>
                    <span className="text-xs tabular-nums px-1 w-14 text-center">{Math.round(zoom * 100)}%</span>
                    <button
                      type="button"
                      className="px-2 py-1 text-sm rounded border border-gray-300 hover:bg-gray-50"
                      onClick={() => { setAutoFit(false); setZoom(z => clampZoom(z + 0.1)); }}
                      title="Zoom in"
                      disabled={!hasImage}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                    onClick={() => { setAutoFit(false); setZoom(1); }}
                    title="Actual size (100%)"
                    disabled={!hasImage}
                  >
                    100%
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                    onClick={() => { setAutoFit(true); setZoom(fitZoom); }}
                    title="Fit to view"
                    disabled={!hasImage}
                  >
                    Fit
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={adj.autoWhiteBalance}
                  onChange={(e) => setAdj(a => ({ ...a, autoWhiteBalance: e.target.checked }))}
                />
                <span className="font-medium">Auto White Balance</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={adj.autoColorEnhance}
                  onChange={(e) => setAdj(a => ({ ...a, autoColorEnhance: e.target.checked }))}
                />
                <span className="font-medium">Auto Color Enhance</span>
              </label>

              <Slider
                label="Gaussian Blur (px)"
                min={0}
                max={10}
                step={0.1}
                value={adj.blurPx}
                defaultValue={0}
                onChange={(v) => setAdj(a => ({ ...a, blurPx: v }))}
              />

              <Slider
                label="Noise (σ)"
                min={0}
                max={50}
                step={1}
                value={adj.noiseSigma}
                defaultValue={0}
                onChange={(v) => setAdj(a => ({ ...a, noiseSigma: v }))}
              />

              <div className="pt-2 border-t">
                <p className="font-medium mb-2">Color Enhancement</p>
                <Slider
                  label="Brightness (%)"
                  min={-100}
                  max={100}
                  step={1}
                  value={adj.brightness}
                  defaultValue={0}
                  onChange={(v) => setAdj(a => ({ ...a, brightness: v }))}
                />
                <Slider
                  label="Contrast (%)"
                  min={-100}
                  max={100}
                  step={1}
                  value={adj.contrast}
                  defaultValue={0}
                  onChange={(v) => setAdj(a => ({ ...a, contrast: v }))}
                />
                <Slider
                  label="Saturation (%)"
                  min={-100}
                  max={100}
                  step={1}
                  value={adj.saturation}
                  defaultValue={0}
                  onChange={(v) => setAdj(a => ({ ...a, saturation: v }))}
                />
              </div>

              <div className="flex items-center justify-between">
                {working && <p className="text-xs text-gray-500">Processing…</p>}
                {actionMsg && <p className="text-xs text-gray-600">{actionMsg}</p>}
              </div>

              <div className="pt-2 border-t">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium">Actions</p>
                  <button className="text-sm px-2 py-1 rounded border" onClick={reset} disabled={!hasImage}>
                    Reset
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                    onClick={copyToClipboard}
                    disabled={!hasImage || working}
                    title="Copy processed image to clipboard"
                  >
                    Copy to Clipboard
                  </button>
                  <button
                    className="text-sm px-2 py-1 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
                    onClick={downloadImage}
                    disabled={!hasImage || working}
                    title="Download processed image as PNG"
                  >
                    Download PNG
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type SliderProps = {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
};

function Slider({ label, min, max, step = 1, value, defaultValue, onChange }: SliderProps) {
  const isDefault = value === defaultValue;
  const displayValue = Number.isFinite(value)
    ? (step < 1 ? Math.round(value * (1 / step)) / (1 / step) : Math.round(value))
    : 0;

  const [inputStr, setInputStr] = React.useState<string>(String(displayValue));

  // Keep the text input in sync when external value changes
  React.useEffect(() => {
    setInputStr(String(displayValue));
  }, [displayValue]);

  const commit = React.useCallback((raw: string) => {
    const n = parseFloat(raw);
    if (Number.isNaN(n)) {
      // Revert to current value on invalid input
      setInputStr(String(displayValue));
      return;
    }
    let v = n;
    if (v < min) v = min;
    if (v > max) v = max;
    onChange(v);
    setInputStr(String(step < 1 ? Math.round(v * (1 / step)) / (1 / step) : Math.round(v)));
  }, [min, max, onChange, step, displayValue]);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm select-none">{label}</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode={step < 1 ? 'decimal' : 'numeric'}
            step={step}
            min={min}
            max={max}
            value={inputStr}
            onChange={(e) => {
              const s = e.target.value;
              setInputStr(s);
              const n = parseFloat(s);
              if (!Number.isNaN(n)) {
                let v = n;
                if (v < min) v = min;
                if (v > max) v = max;
                onChange(v);
              }
            }}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
            className="text-xs leading-none px-1.5 py-0.5 w-12 rounded border border-gray-300 text-right"
            aria-label={`${label} numeric input`}
          />
          <button
            type="button"
            title="Reset to default"
            aria-label={`Reset ${label} to ${defaultValue}`}
            onClick={() => onChange(defaultValue)}
            className={`text-xs leading-none px-1.5 py-0.5 rounded border transition-colors ${isDefault ? 'text-gray-400 border-gray-200' : 'text-gray-700 border-gray-300 hover:bg-gray-50'}`}
          >
            ↺
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-blue-600"
      />
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
