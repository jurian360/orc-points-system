'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CameraCapture from './CameraCapture';
import {
  drawGridOverlay,
  LETTER_COLUMNS,
  ORC_ROWS,
  ORC_ROWS_PER_BLOCK,
  scanScorecard,
  TesseractRecognizer,
  TIME_ROWS,
  toScanPayload,
} from '../lib/ocr';
import type { Quad, Recognizer, ScanProgress, ScanResult } from '../lib/ocr';

/** Only the sections the scanner is allowed to fill: ORC letters and the times. */
export interface ScannedSheet {
  orc: string[][];
  time: { ipt: string; wpt: string; plusMinus: string }[];
}

interface ScorecardScannerProps {
  open: boolean;
  onClose: () => void;
  onApply: (values: ScannedSheet) => void;
  /** Shown next to what the card's header says, as a cross-check. */
  selectedEq: number | '';
  selectedStageName?: string;
}

type Step = 'capture' | 'scanning' | 'review' | 'error';

/** Below this the value is almost certainly wrong; below MEDIUM, worth a look. */
const CONFIDENCE_LOW = 0.55;
const CONFIDENCE_MEDIUM = 0.75;

const confidenceClass = (confidence: number, empty: boolean): string => {
  if (empty) return 'border-gray-300';
  if (confidence < CONFIDENCE_LOW) return 'border-red-400 bg-red-50';
  if (confidence < CONFIDENCE_MEDIUM) return 'border-amber-400 bg-amber-50';
  return 'border-green-400 bg-green-50';
};

const emptySheet = (): ScannedSheet => ({
  orc: Array.from({ length: ORC_ROWS }, () => Array(LETTER_COLUMNS).fill('')),
  time: Array.from({ length: TIME_ROWS }, () => ({ ipt: '', wpt: '', plusMinus: '' })),
});

/**
 * Camera-to-form scanner for a paper controlekaart.
 *
 * The scan is a draft, never an answer: every recognised value lands in an
 * editable field, colour-coded by confidence, and nothing reaches the real form
 * until the operator presses Apply. Strafpunten and Merk are never touched —
 * those are the officials' judgement, not something to guess from a photo.
 */
const ScorecardScanner: React.FC<ScorecardScannerProps> = ({
  open,
  onClose,
  onApply,
  selectedEq,
  selectedStageName,
}) => {
  const [step, setStep] = useState<Step>('capture');
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [draft, setDraft] = useState<ScannedSheet>(emptySheet);

  const recognizerRef = useRef<Recognizer | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // The OCR workers are expensive to spin up (a few MB of wasm plus the language
  // model), so they live as long as the dialog does and are reused between cards.
  const releaseRecognizer = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    recognizerRef.current?.destroy();
    recognizerRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) {
      releaseRecognizer();
      setStep('capture');
      setResult(null);
      setProgress(null);
      setError(null);
      setDraft(emptySheet());
    }
  }, [open, releaseRecognizer]);

  useEffect(() => releaseRecognizer, [releaseRecognizer]);

  useEffect(() => {
    if (step !== 'review' || !result || !overlayRef.current) return;
    drawGridOverlay(overlayRef.current, result.warped, result.grid);
  }, [step, result]);

  const runScan = async (image: ImageData, quad: Quad) => {
    setStep('scanning');
    setError(null);
    setProgress({ phase: 'preparing', ratio: 0, message: 'Preparing…' });

    const controller = new AbortController();
    abortRef.current = controller;
    if (!recognizerRef.current) recognizerRef.current = new TesseractRecognizer();

    try {
      const scan = await scanScorecard(image, quad, recognizerRef.current, {
        onProgress: setProgress,
        signal: controller.signal,
      });

      setResult(scan);
      setDraft({
        orc: scan.orc.map((row) => row.map((cell) => cell.text)),
        time: scan.time.map((row) => ({
          ipt: row.ipt.text,
          wpt: row.wpt.text,
          plusMinus: row.plusMinus.text,
        })),
      });
      setStep('review');
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      console.error(caught);
      setError(caught instanceof Error ? caught.message : 'The scan failed.');
      setStep('error');
    }
  };

  if (!open) return null;

  const cardEq = result?.eqNo.text ?? '';
  const eqMismatch =
    cardEq !== '' && selectedEq !== '' && Number(cardEq) !== Number(selectedEq);

  const setOrcCell = (row: number, column: number, value: string) =>
    setDraft((previous) => {
      const orc = previous.orc.map((cells) => [...cells]);
      orc[row][column] = value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 1);
      return { ...previous, orc };
    });

  const setTimeCell = (row: number, field: 'ipt' | 'wpt' | 'plusMinus', value: string) =>
    setDraft((previous) => {
      const time = previous.time.map((entry) => ({ ...entry }));
      time[row][field] = value;
      return { ...previous, time };
    });

  const renderOrcBlock = (offset: number) => (
    <table className="border-collapse">
      <thead>
        <tr className="bg-green-100">
          <th className="py-1 px-1 border border-gray-300 text-[10px] font-bold text-gray-800 w-7">
            NR
          </th>
          <th
            colSpan={LETTER_COLUMNS}
            className="py-1 px-1 border border-gray-300 text-[10px] font-bold text-gray-800"
          >
            LETTERS
          </th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: ORC_ROWS_PER_BLOCK }, (_, index) => {
          const row = offset + index;
          return (
            <tr key={row}>
              <td className="py-0.5 px-1 border border-gray-300 font-bold text-xs text-gray-800 text-center">
                {row + 1}
              </td>
              {Array.from({ length: LETTER_COLUMNS }, (_, column) => {
                const cell = result?.orc[row][column];
                return (
                  <td key={column} className="p-0.5 border border-gray-300">
                    <input
                      type="text"
                      maxLength={1}
                      value={draft.orc[row][column]}
                      onChange={(event) => setOrcCell(row, column, event.target.value)}
                      title={cell?.stamped ? 'Stamp detected — left blank' : undefined}
                      className={`w-8 h-7 p-0 border-2 rounded text-center text-base font-bold uppercase text-gray-800 ${confidenceClass(
                        cell?.confidence ?? 0,
                        !cell || cell.empty
                      )} ${cell?.stamped ? 'bg-orange-50 border-orange-300' : ''}`}
                      aria-label={`Scanned letter, ORC row ${row + 1}, column ${column + 1}`}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-3 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b-2 border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Scan controlekaart</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-2xl leading-none px-2"
            aria-label="Close scanner"
          >
            &times;
          </button>
        </div>

        <div className="p-5">
          {step === 'capture' && (
            <CameraCapture onConfirm={runScan} onCancel={onClose} />
          )}

          {step === 'scanning' && (
            <div className="py-10 text-center">
              <p className="text-base font-semibold text-gray-800 mb-3">
                {progress?.message ?? 'Scanning…'}
              </p>
              <div className="w-full max-w-md mx-auto h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-600 transition-all duration-200"
                  style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 mt-3">
                The first scan downloads the OCR engine; later scans reuse it.
              </p>
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setStep('capture');
                }}
                className="mt-5 px-5 py-2 text-gray-700 hover:text-gray-900 font-semibold"
              >
                Cancel scan
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="py-8 text-center">
              <p className="text-base font-semibold text-red-700 mb-4">{error}</p>
              <button
                type="button"
                onClick={() => setStep('capture')}
                className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold"
              >
                Try again
              </button>
            </div>
          )}

          {step === 'review' && result && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                <div>
                  <p className="text-sm font-semibold text-gray-800 mb-1">
                    Detected grid
                  </p>
                  <div className="border-2 border-gray-300 rounded-lg overflow-auto max-h-72">
                    <canvas ref={overlayRef} className="w-full h-auto block" />
                  </div>
                  {!result.gridDetected && (
                    <p className="mt-2 text-sm text-amber-800 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
                      The printed rules could not be read, so the grid above is an
                      estimate. Check that the boxes line up before applying.
                    </p>
                  )}
                </div>

                <div className="text-sm text-gray-800 space-y-2">
                  <p className="font-semibold">Header read from the card</p>
                  <p>
                    Controlekaart no.:{' '}
                    <span className="font-bold">{result.controlekaartNo.text || '—'}</span>
                    {selectedStageName && (
                      <span className="text-gray-600"> · selected stage: {selectedStageName}</span>
                    )}
                  </p>
                  <p>
                    EQ no.: <span className="font-bold">{cardEq || '—'}</span>
                    <span className="text-gray-600">
                      {' '}· selected EQ: {selectedEq === '' ? '—' : selectedEq}
                    </span>
                  </p>
                  {eqMismatch && (
                    <p className="text-amber-800 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
                      The card reads EQ {cardEq} but EQ {selectedEq} is selected. The
                      scanner never changes your selection — check you have the right card.
                    </p>
                  )}
                  <p className="text-gray-600">
                    Green means a confident read, amber means check it, red means it is
                    probably wrong. Orange cells held a stamp and were left blank.
                    Strafpunten and Merk are never filled in by the scanner.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 items-start">
                {renderOrcBlock(0)}
                {renderOrcBlock(ORC_ROWS_PER_BLOCK)}

                <table className="border-collapse">
                  <thead>
                    <tr className="bg-yellow-100">
                      <th className="py-1 px-1 border border-gray-300 text-[10px] font-bold text-gray-800 w-7">
                        NR
                      </th>
                      {['IPT', 'WPT', '+/-'].map((label) => (
                        <th
                          key={label}
                          className="py-1 px-1 border border-gray-300 text-[10px] font-bold text-gray-800"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.time.map((row, index) => (
                      <tr key={index}>
                        <td className="py-0.5 px-1 border border-gray-300 font-bold text-xs text-gray-800 text-center">
                          {index + 1}
                        </td>
                        {(['ipt', 'wpt', 'plusMinus'] as const).map((field) => {
                          const cell = result.time[index][field];
                          return (
                            <td key={field} className="p-0.5 border border-gray-300">
                              <input
                                type="text"
                                value={row[field]}
                                onChange={(event) =>
                                  setTimeCell(index, field, event.target.value)
                                }
                                className={`w-16 h-7 p-0.5 border-2 rounded text-center text-sm text-gray-800 ${confidenceClass(
                                  cell.confidence,
                                  cell.empty
                                )}`}
                                aria-label={`Scanned ${field}, time row ${index + 1}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-gray-700">
                  Extraction payload (JSON)
                </summary>
                <pre className="mt-2 p-3 bg-gray-900 text-gray-100 rounded-lg overflow-x-auto text-xs">
                  {JSON.stringify(toScanPayload(result), null, 2)}
                </pre>
              </details>

              <div className="flex flex-wrap gap-2 border-t-2 border-gray-200 pt-4">
                <button
                  type="button"
                  onClick={() => onApply(draft)}
                  className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow"
                >
                  Apply to answer sheet
                </button>
                <button
                  type="button"
                  onClick={() => setStep('capture')}
                  className="px-5 py-2.5 bg-white border-2 border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 font-semibold"
                >
                  Scan again
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 text-gray-700 hover:text-gray-900 font-semibold"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ScorecardScanner;
