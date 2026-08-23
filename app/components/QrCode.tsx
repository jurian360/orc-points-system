'use client';

import React, { useMemo } from 'react';

import { encodeQr, qrPathData, qrViewBoxSize } from '../lib/qrcode';

interface QrCodeProps {
  // The text the scanner will read back.
  value: string;
  // Rendered side in pixels, quiet zone included.
  size?: number;
  // Alternative text for the printed page; the code below the symbol is what a
  // sighted user reads, so this describes what the symbol is for.
  title?: string;
  className?: string;
}

// One QR symbol, rendered as SVG so it stays sharp on paper at any size.
//
// The encoder (app/lib/qrcode.ts) is pure and runs in the browser, so nothing
// has to be fetched or generated server-side to show a sheet of these.
export default function QrCode({ value, size = 160, title, className = '' }: QrCodeProps) {
  const matrix = useMemo(() => encodeQr(value), [value]);
  const side = qrViewBoxSize(matrix);
  const path = useMemo(() => qrPathData(matrix), [matrix]);

  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title || value}
      className={className}
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
