'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StageForm from '../../../../components/StageForm';

export default function NewStagePage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [rallyId, setRallyId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
    };
    getParams();
  }, [params]);

  const handleSubmit = async (
    stageName: string,
    scoreKey: any[],
    timeScoreKey: any[],
    merkScoreKey: any[]
  ) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/stages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rallyId,
          name: stageName,
          scoreKey,
          timeScoreKey,
          merkScoreKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create stage');
      }

      router.push(`/rallies/${rallyId}`);
    } catch (err) {
      setError('Failed to create stage. Please try again.');
      console.error(err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-[1700px] mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Add Stage</h1>
          <p className="text-gray-600 mt-2">Enter the stage name and its answer key.</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <StageForm onSubmit={handleSubmit} />
        </div>

        <div className="mt-6">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline">
            &larr; Back to Rally
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg">
            <p className="text-lg">Creating stage...</p>
          </div>
        </div>
      )}
    </div>
  );
}
