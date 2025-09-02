import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Adjustments } from '../lib/imageOps';
import { applyPipeline } from '../lib/imageOps';

const defaultAdj: Adjustments = {
  autoWhiteBalance: false,
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

  // Load image into offscreen canvas
  const loadImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    setImageURL(url);
    setFileName(file.name);
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
  }, []);

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

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900 flex items-center justify-center">
      <div className="mx-auto max-w-6xl p-4 w-full">
        <h1 className="text-2xl font-semibold mb-6 text-center">Jason's Image Gen Fixer</h1>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
          <div className="md:col-span-8">
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
              className="bg-white rounded-lg shadow p-3 flex items-center justify-center overflow-auto min-h-[300px]"
            >
              {hasImage ? (
                <canvas ref={canvasRef} className="max-w-full h-auto" />
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
              <div className="flex items-center justify-between">
                <div className="truncate">
                  <p className="font-medium">{fileName ?? 'No image loaded'}</p>
                  <p className="text-xs text-gray-500">{hasImage ? `${imgDims?.w}×${imgDims?.h}px` : 'Drop or browse an image'}</p>
                </div>
                <button className="text-sm px-2 py-1 rounded border" onClick={reset} disabled={!hasImage}>
                  Reset
                </button>
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

              {working && <p className="text-xs text-gray-500">Processing…</p>}
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
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm select-none">{label}</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 tabular-nums min-w-8 text-right">{displayValue}</span>
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
