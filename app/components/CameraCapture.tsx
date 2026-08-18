'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultQuad,
  detectCardQuad,
  imageDataFromFile,
  imageDataFromVideo,
  imageDataToCanvas,
} from '../lib/ocr';
import type { Point, Quad } from '../lib/ocr';

interface CameraCaptureProps {
  /** Called once the operator is happy with the framing. */
  onConfirm: (image: ImageData, quad: Quad) => void;
  onCancel: () => void;
}

/** Aspect ratio of the SARK controlekaart, used for the alignment guide. */
const CARD_ASPECT = 1.45;

const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

/**
 * Camera view with an alignment guide, then a corner-adjustment step.
 *
 * The manual corner step is not a fallback, it is the design: automatic corner
 * detection is a heuristic that a hand holding the card, a busy table or a
 * shadow can all defeat, and dragging four handles takes two seconds. The
 * detector's job is to be right often enough that the handles rarely move.
 */
const CameraCapture: React.FC<CameraCaptureProps> = ({ onConfirm, onCancel }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const [captured, setCaptured] = useState<ImageData | null>(null);
  const [quad, setQuad] = useState<Quad | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  // Start the rear camera as soon as the step opens; a card is always shot from
  // the back camera, and asking the operator to pick one costs a tap.
  useEffect(() => {
    if (captured) return;
    let cancelled = false;

    const start = async () => {
      setStarting(true);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('This browser has no camera API. Use "Choose a photo" instead.');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraError(null);
      } catch (error) {
        if (!cancelled) {
          setCameraError(
            error instanceof Error
              ? `Camera unavailable: ${error.message}`
              : 'Camera unavailable.'
          );
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [captured, stopStream]);

  // Paint the still into the adjustment canvas whenever a new one arrives.
  useEffect(() => {
    if (!captured || !previewRef.current) return;
    const canvas = previewRef.current;
    canvas.width = captured.width;
    canvas.height = captured.height;
    canvas.getContext('2d')?.drawImage(imageDataToCanvas(captured), 0, 0);
  }, [captured]);

  const acceptImage = useCallback((image: ImageData) => {
    stopStream();
    setCaptured(image);
    setQuad(detectCardQuad(image) ?? defaultQuad(image.width, image.height));
  }, [stopStream]);

  const handleShutter = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    acceptImage(imageDataFromVideo(video));
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      acceptImage(await imageDataFromFile(file));
    } catch {
      setCameraError('That file could not be read as an image.');
    }
  };

  // Pointer position in image coordinates. The SVG carries a viewBox in image
  // space, so this is the one conversion the drag needs.
  const toImagePoint = (event: React.PointerEvent): Point | null => {
    const svg = svgRef.current;
    if (!svg || !captured) return null;
    const bounds = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * captured.width,
      y: ((event.clientY - bounds.top) / bounds.height) * captured.height,
    };
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (dragIndex === null || !captured || !quad) return;
    const point = toImagePoint(event);
    if (!point) return;
    const next = [...quad] as Quad;
    next[dragIndex] = {
      x: Math.max(0, Math.min(captured.width, point.x)),
      y: Math.max(0, Math.min(captured.height, point.y)),
    };
    setQuad(next);
  };

  if (captured && quad) {
    const handleRadius = Math.max(10, captured.width / 55);

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-gray-700">
          Drag the four handles onto the corners of the card, then scan.
        </p>

        <div className="relative bg-gray-900 rounded-lg overflow-hidden">
          <canvas ref={previewRef} className="w-full h-auto block" />
          <svg
            ref={svgRef}
            viewBox={`0 0 ${captured.width} ${captured.height}`}
            className="absolute inset-0 w-full h-full touch-none"
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragIndex(null)}
            onPointerCancel={() => setDragIndex(null)}
          >
            <polygon
              points={quad.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="rgba(16,185,129,0.15)"
              stroke="#10b981"
              strokeWidth={Math.max(2, captured.width / 320)}
            />
            {quad.map((point, index) => (
              <circle
                key={CORNER_LABELS[index]}
                cx={point.x}
                cy={point.y}
                r={handleRadius}
                fill={dragIndex === index ? '#059669' : 'rgba(255,255,255,0.9)'}
                stroke="#047857"
                strokeWidth={Math.max(2, captured.width / 400)}
                className="cursor-grab"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setDragIndex(index);
                }}
              />
            ))}
          </svg>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onConfirm(captured, quad)}
            className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow"
          >
            Scan card
          </button>
          <button
            type="button"
            onClick={() => {
              setCaptured(null);
              setQuad(null);
            }}
            className="px-5 py-2.5 bg-white border-2 border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 font-semibold"
          >
            Retake
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-gray-700 hover:text-gray-900 font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-700">
        Fill the frame with the card, keeping the whole border inside the guide.
      </p>

      <div className="relative bg-gray-900 rounded-lg overflow-hidden min-h-[240px]">
        <video ref={videoRef} playsInline muted autoPlay className="w-full h-auto block" />

        {/* Alignment guide: a card-shaped hole in a dimmed overlay. */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className="w-[88%] rounded-lg border-2 border-green-400"
            style={{ aspectRatio: String(CARD_ASPECT), boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
          />
        </div>

        {(starting || cameraError) && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 p-6 text-center">
            <p className="text-sm text-gray-100">
              {cameraError ?? 'Starting the camera…'}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={handleShutter}
          disabled={Boolean(cameraError) || starting}
          className="px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 font-bold shadow disabled:bg-gray-300 disabled:text-gray-500"
        >
          Capture
        </button>

        <label className="px-5 py-2.5 bg-white border-2 border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 font-semibold cursor-pointer">
          Choose a photo
          <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </label>

        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 text-gray-700 hover:text-gray-900 font-semibold"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default CameraCapture;
