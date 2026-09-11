'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ResultImportWizard from '../components/ResultImportWizard';
import { PAGE_CONTAINER } from '../lib/layout';

// Importing the result of a rally the club rode **before this system
// existed**: a finishing order and the crews, with no answer sheets and no
// score keys behind it.
//
// Admin only, like the other imports — `middleware.ts` keeps everybody else
// off the page and the route refuses them anyway.
function ResultImportPage() {
  const searchParams = useSearchParams();
  const rallyId = searchParams.get('rallyId') ?? undefined;

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className={PAGE_CONTAINER}>
        <div className="mb-6">
          <Link href="/rallies" className="text-blue-600 hover:underline text-base">
            ← Rallies
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Import rally results</h1>
          <p className="text-gray-600 text-base mt-1 max-w-4xl">
            For the rallies the club rode before this system: their finishing order and the
            crews, typed in from the results that already exist. There are no answer sheets
            and no score keys to re-score from, and none are needed — the overall standings
            rank a season on <strong>finish positions</strong>, which is the one thing every
            rally has, whether it was scored here or on paper.
          </p>
        </div>

        <Suspense fallback={<p className="text-lg text-gray-600">Loading…</p>}>
          <ResultImportWizard initialRallyId={rallyId} />
        </Suspense>
      </div>
    </div>
  );
}

// `useSearchParams` needs a Suspense boundary above it for the static shell,
// the same arrangement /time-import uses.
export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResultImportPage />
    </Suspense>
  );
}
