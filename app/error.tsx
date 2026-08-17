'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Something went wrong!
          </h2>
          {/*
            Deliberately generic. Rendering error.message can surface internal
            paths, driver errors, or library internals; the digest is enough to
            correlate a user report with the server log.
          */}
          <p className="mt-2 text-center text-sm text-gray-600">
            An unexpected error occurred. Please try again.
          </p>
          {error.digest && (
            <p className="mt-1 text-center text-xs text-gray-400">
              Reference: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-col items-center justify-center space-y-4">
          <button
            onClick={() => reset()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try again
          </button>
          <Link href="/" className="text-blue-600 hover:underline">
            Return to Home
          </Link>
        </div>
      </div>
    </div>
  );
}