# ai-image-fixer — Project Context

This document summarizes the current state of the codebase.

## Overview

- Client-side image editor built with React, TypeScript, Vite, and Tailwind.
- Users can load an image (drag-and-drop or file picker), apply a series of image adjustments, and see results in a canvas.
- No backend or persistence; all processing happens in the browser via Canvas ImageData.

## App Structure

- `my-project/index.html`: Vite entry HTML with `#root` mount.
- `my-project/src/main.tsx`: React bootstrap (`StrictMode`, render `App`).
- `my-project/src/App.tsx`: Renders the `ImageEditor` component.
- `my-project/src/components/ImageEditor.tsx`: Main UI and interaction logic.
- `my-project/src/lib/imageOps.ts`: Pure functions for image processing and a pipeline orchestrator.
- Styling and tooling:
  - `my-project/src/index.css`: Imports Tailwind (`@import "tailwindcss"`) and base styles.
  - `my-project/vite.config.ts`: Vite configured with React and Tailwind plugins.
  - `my-project/eslint.config.js`: ESLint for JS/TS/React.
  - `my-project/tsconfig*.json`: TypeScript compiler config (app/node).

## Key Feature: Image Editor

- Load Image
  - Drag-and-drop or file input; only accepts `image/*`.
  - The image is downscaled to a max dimension of 1600 px for performance, then drawn to an offscreen source canvas.
  - Dimensions are shown alongside the filename.

- Adjustments UI
  - Controls: Auto White Balance (checkbox), Gaussian Blur, Noise (sigma), Brightness, Contrast, Saturation (all via slider + numeric input).
  - Numeric inputs are synchronized with sliders, constrained by min/max/step, and commit on blur/Enter.
  - Sliders include a reset button to return to default values.
  - A small “Processing…” indicator shows while applying changes.

- Processing Flow
  - Debounced adjustments (~60–80ms) to avoid frequent re-renders while dragging.
  - Reads `ImageData` from the offscreen canvas, applies a pipeline of operations, and paints results into a visible canvas.

## Image Processing Library (`src/lib/imageOps.ts`)

- Types
  - `Adjustments`: `{ autoWhiteBalance, noiseSigma, blurPx, brightness, contrast, saturation }`.
  - Utility: `clamp` to bound channels 0–255.

- Operations
  - `applyAutoWhiteBalance`: Per-channel auto-level with ~0.5% histogram clipping (gray-world-ish outcome), computed via LUTs.
  - `applyGaussianNoise`: Adds Box–Muller Gaussian noise per RGB channel (`sigma` in 0–50 typical range).
  - `applyBrightnessContrast`: Standard brightness offset and contrast factor (centering around 128).
  - `applySaturation`: RGB↔HSL conversion, scales saturation by a factor, then converts back.
  - `applyGaussianBlur`: Separable Gaussian blur using a normalized kernel with radius ≈ `ceil(σ*3)`; horizontal + vertical passes.

- Pipeline
  - `applyPipeline(input, adj)`: Applies in order: Auto WB → Noise → Brightness/Contrast → Saturation → Blur.

## UI Component Details (`src/components/ImageEditor.tsx`)

- State
  - `imageURL`, `fileName`, `imgDims`, `adj` for adjustments, `working` boolean, refs for visible and source canvases.
  - Debounced `adj` state to throttle processing.

- Canvas handling
  - Offscreen canvas stores the original (possibly downscaled) image.
  - Visible canvas receives processed `ImageData` via `putImageData`.

- Controls
  - Sliders with numeric inputs (narrow width, Tailwind `w-12`), min/max/step enforced, reset to defaults.
  - Auto White Balance checkbox toggle.

## Tooling & Scripts

- `package.json` (under `my-project/`):
  - Scripts: `dev` (Vite), `build` (TS build + Vite), `lint` (ESLint), `preview` (Vite preview).
  - React 19, Vite 7, Tailwind 4, TypeScript 5.8.

- ESLint / TS
  - TS strict settings, recommended React Hooks and Vite refresh lint configs.
  - Project references for Node and App configs.

## Recent Changes

- Added numeric inputs to each slider control to allow typing exact values.
- Reduced numeric input width to be more compact (Tailwind class `w-12`).

## Notes & Potential Next Steps

- Everything runs client-side; no server work is required.
- Consider add-ons:
  - Export/download processed image at original resolution.
  - Keyboard nudge for focused sliders/inputs.
  - Persist last-used settings in localStorage.
  - GPU acceleration via WebGL/WebGPU for heavy blurs.

