'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ParticipantAnswersView from '../../../../components/ParticipantAnswersView';

// Participant numbers are integers 1-100 (the AnswerSheet schema's range).
const parseEqParam = (value: string): number | null => {
  if (!/^\d{1,3}$/.test(value)) return null;
  const eq = Number(value);
  return eq >= 1 && eq <= 100 ? eq : null;
};

export default function ParticipantAnswersPage({
  params,
}: {
  params: Promise<{ id: string; eq: string }>;
}) {
  const [rallyId, setRallyId] = useState<string>('');
  const [eq, setEq] = useState<number | null>(null);
  const [invalidEq, setInvalidEq] = useState(false);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      const parsed = parseEqParam(resolved.eq);
      setEq(parsed);
      setInvalidEq(parsed === null);
    };
    getParams();
  }, [params]);

  if (invalidEq) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">
            Invalid participant number. Participants are numbered 1 to 100.
          </p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  if (!rallyId || eq === null) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return <ParticipantAnswersView rallyId={rallyId} eq={eq} />;
}
