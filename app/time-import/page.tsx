'use client';

import React, { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import TimeImportWizard from '../components/TimeImportWizard';

// The time import as its own page rather than a panel on the rally: the file a
// control hands in says nothing about where it belongs, so picking the rally is
// the first step of the wizard itself. Opening it from a rally or a stage
// pre-selects those through the query string.
const TimeImportPage: React.FC = () => {
  const searchParams = useSearchParams();

  return (
    <TimeImportWizard
      initialRallyId={searchParams.get('rallyId') || undefined}
      initialStageId={searchParams.get('stageId') || undefined}
    />
  );
};

export default function TimeImportRoute() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-5xl mx-auto px-4">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Import Times</h1>
          <p className="text-gray-600 mt-1 text-base">
            Read the export of a time control — its participant numbers and passage times — into
            one row of a stage&apos;s time column. The times are scored exactly as if an official
            had typed them on the card: the delta of every later stage moves with them.
          </p>
        </div>

        <Suspense
          fallback={<p className="text-lg font-semibold text-gray-700">Loading…</p>}
        >
          <TimeImportPage />
        </Suspense>

        <div className="mt-8">
          <Link href="/rallies" className="text-blue-600 hover:underline text-lg font-medium">
            &larr; Back to Rallies
          </Link>
        </div>
      </div>
    </div>
  );
}
