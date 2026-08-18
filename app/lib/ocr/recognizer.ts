// Character recognition for the scanner.
//
// The pipeline talks to this interface, never to Tesseract directly. Recognition
// is the one part of the pipeline that is genuinely hard to get right on
// handwriting, so it is the part most likely to be replaced — by a small
// EMNIST-style classifier, or by a server-side engine. Segmentation, stamp
// removal and grid detection are engine-independent and stay put.
//
// See docs/SCORECARD-OCR.md for the accuracy trade-offs behind that split.

export interface RecognizedText {
  text: string;
  /** 0..1. */
  confidence: number;
}

export type RecognizeKind = 'letter' | 'time' | 'plusMinus' | 'cardNumber' | 'eqNumber';

export interface Recognizer {
  init(onProgress?: (ratio: number) => void): Promise<void>;
  read(image: HTMLCanvasElement, kind: RecognizeKind): Promise<RecognizedText>;
  destroy(): Promise<void>;
}

export class OcrAssetsMissingError extends Error {
  constructor() {
    super(
      'OCR runtime not found under /ocr. Run `npm run setup:ocr` (it also runs automatically before dev/build).'
    );
    this.name = 'OcrAssetsMissingError';
  }
}

const ASSET_BASE = '/ocr';

/** Whitelists are the single biggest accuracy lever available on a fixed grid. */
const MODES: Record<RecognizeKind, { whitelist: string; psm: string; pool: 'alpha' | 'numeric' }> = {
  // PSM 10 — treat the image as a single character. The cell is already
  // segmented, so any layout analysis Tesseract does can only hurt.
  letter: { whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', psm: '10', pool: 'alpha' },
  // PSM 7 — one text line. Times are 3-5 glyphs written as a unit.
  time: { whitelist: '0123456789:.+-', psm: '7', pool: 'numeric' },
  plusMinus: { whitelist: '0123456789:.+-', psm: '7', pool: 'numeric' },
  cardNumber: { whitelist: 'IVX0123456789', psm: '7', pool: 'alpha' },
  eqNumber: { whitelist: '0123456789', psm: '7', pool: 'numeric' },
};

type TesseractWorker = {
  setParameters(parameters: Record<string, string>): Promise<unknown>;
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string; confidence: number } }>;
  terminate(): Promise<unknown>;
};

async function assetsPresent(): Promise<boolean> {
  const probes = ['worker.min.js', 'eng.traineddata.gz'];
  try {
    const responses = await Promise.all(
      probes.map((file) => fetch(`${ASSET_BASE}/${file}`, { method: 'HEAD' }))
    );
    return responses.every((response) => response.ok);
  } catch {
    return false;
  }
}

/**
 * Tesseract.js, running entirely from self-hosted assets.
 *
 * Two workers rather than one: switching `tessedit_char_whitelist` forces
 * Tesseract to rebuild its character set, and the pipeline alternates between
 * letters and digits constantly. One worker per character class means the
 * whitelist is set once each.
 */
export class TesseractRecognizer implements Recognizer {
  private alpha: TesseractWorker | null = null;
  private numeric: TesseractWorker | null = null;
  // Cached by whitelist+psm rather than by kind, so kinds that share a
  // character set (time and +/-) do not force a reconfigure between cells.
  private modes: { alpha: string | null; numeric: string | null } = {
    alpha: null,
    numeric: null,
  };

  async init(onProgress?: (ratio: number) => void): Promise<void> {
    if (this.alpha && this.numeric) return;

    if (!(await assetsPresent())) throw new OcrAssetsMissingError();

    // Dynamic import: Tesseract and its wasm loader are several hundred KB of
    // JavaScript that no other page in the app needs.
    const tesseract = await import('tesseract.js');

    const options = {
      workerPath: `${ASSET_BASE}/worker.min.js`,
      corePath: `${ASSET_BASE}/`,
      langPath: ASSET_BASE,
      gzip: true,
      // Load the worker straight from its own URL instead of wrapping it in a
      // blob: URL, so worker-src can stay at 'self' in the CSP.
      workerBlobURL: false,
      logger: onProgress
        ? (message: { progress?: number }) => onProgress(message.progress ?? 0)
        : undefined,
    };

    const [alpha, numeric] = await Promise.all([
      tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, options),
      tesseract.createWorker('eng', tesseract.OEM.LSTM_ONLY, options),
    ]);

    this.alpha = alpha as unknown as TesseractWorker;
    this.numeric = numeric as unknown as TesseractWorker;
  }

  private async workerFor(kind: RecognizeKind): Promise<TesseractWorker> {
    const mode = MODES[kind];
    const worker = mode.pool === 'alpha' ? this.alpha : this.numeric;
    if (!worker) throw new Error('Recognizer used before init()');

    const signature = `${mode.psm}:${mode.whitelist}`;
    if (this.modes[mode.pool] !== signature) {
      await worker.setParameters({
        tessedit_char_whitelist: mode.whitelist,
        tessedit_pageseg_mode: mode.psm,
      });
      this.modes[mode.pool] = signature;
    }

    return worker;
  }

  async read(image: HTMLCanvasElement, kind: RecognizeKind): Promise<RecognizedText> {
    const worker = await this.workerFor(kind);
    const { data } = await worker.recognize(image);
    return {
      text: data.text.replace(/\s+/g, ''),
      confidence: Math.max(0, Math.min(1, data.confidence / 100)),
    };
  }

  async destroy(): Promise<void> {
    const workers = [this.alpha, this.numeric].filter(Boolean) as TesseractWorker[];
    this.alpha = null;
    this.numeric = null;
    this.modes = { alpha: null, numeric: null };
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => undefined)));
  }
}
