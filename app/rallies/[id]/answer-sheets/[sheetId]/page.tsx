'use client';

import React, { useState, useEffect } from 'react';
import AnswerSheetScoringView from '../../../../components/AnswerSheetScoringView';

export default function AnswerSheetScoringPage({
  params,
}: {
  params: Promise<{ id: string; sheetId: string }>;
}) {
  const [rallyId, setRallyId] = useState<string>('');
  const [sheetId, setSheetId] = useState<string>('');

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setSheetId(resolved.sheetId);
    };
    getParams();
  }, [params]);

  if (!rallyId || !sheetId) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return <AnswerSheetScoringView rallyId={rallyId} sheetId={sheetId} />;
}
