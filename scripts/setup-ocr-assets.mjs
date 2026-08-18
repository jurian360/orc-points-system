#!/usr/bin/env node
// Stage the Tesseract.js runtime under public/ocr so the scanner works without
// any third-party origin.
//
// This matters for two reasons: the CSP in next.config.ts keeps connect-src and
// script-src at 'self', and a rally field office cannot rely on a CDN being
// reachable. Everything is copied out of node_modules, so no network access is
// needed beyond the `npm ci` that already has to happen — the files are build
// outputs and are not committed.
//
// Runs automatically before `npm run dev` and `npm run build`. A failure is a
// warning, not a build break: the app still works, the scanner reports that its
// assets are missing.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'ocr');

// The worker entry point plus the LSTM cores. Both the SIMD and the plain build
// are staged: the worker picks one at runtime after feature-detecting SIMD.
const COPIES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'tesseract-core-simd-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
];

// LSTM-only workers want the `_best_int` model — the same one tesseract.js
// fetches from its CDN when langPath is left unset.
const TRAINEDDATA = [
  'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  'eng.traineddata.gz',
];

const exists = async (path) => {
  try {
    const info = await stat(path);
    return info.size > 0;
  } catch {
    return false;
  }
};

async function main() {
  await mkdir(target, { recursive: true });

  for (const [from, to] of [...COPIES, TRAINEDDATA]) {
    const source = join(root, from);
    if (!(await exists(source))) {
      throw new Error(`missing ${from} — run npm install first`);
    }
    await copyFile(source, join(target, to));
  }

  console.log(`[ocr-assets] staged ${COPIES.length + 1} files in public/ocr.`);
}

main().catch((error) => {
  console.warn(`[ocr-assets] could not stage OCR assets: ${error.message}`);
  console.warn('[ocr-assets] the app will build; the scorecard scanner stays disabled.');
});
