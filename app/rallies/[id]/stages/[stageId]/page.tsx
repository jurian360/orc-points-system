'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Stage {
  _id: string;
  rallyId: string;
  name: string;
  createdAt: string;
  scoreKey: {
    rowNumber: number;
    answers: string[];
    falseAnswers?: { column: number; value: string }[];
    maxPenalty?: number;
  }[];
}

export default function ViewStagePage({
  params,
}: {
  params: Promise<{ id: string; stageId: string }>;
}) {
  const [rallyId, setRallyId] = useState<string>('');
  const [stageId, setStageId] = useState<string>('');
  const [stage, setStage] = useState<Stage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getParams = async () => {
      const resolved = await params;
      setRallyId(resolved.id);
      setStageId(resolved.stageId);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!stageId) return;

    const fetchStage = async () => {
      try {
        const response = await fetch(`/api/stages/${stageId}`);
        if (!response.ok) throw new Error('Failed to fetch stage');
        setStage(await response.json());
      } catch (err) {
        setError('Failed to load stage. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchStage();
  }, [stageId]);

  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg font-semibold">Loading stage...</p>
      </div>
    );
  }

  if (error || !stage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg font-semibold mb-4">{error || 'Stage not found'}</p>
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg">
            Back to Rally
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-800">{stage.name}</h1>
          <p className="text-gray-600 mt-2 text-lg">Created: {formatDate(stage.createdAt)}</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6">
          <div className="p-6">
            <h2 className="text-2xl font-semibold mb-4 text-gray-800">Answer Key</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-blue-50">
                    <th className="py-3 px-6 border border-gray-300 text-left text-base font-semibold text-gray-800">Row</th>
                    <th className="py-3 px-6 border border-gray-300 text-left text-base font-semibold text-gray-800">Correct Answers</th>
                    <th className="py-3 px-6 border border-gray-300 text-left text-base font-semibold text-gray-800">False Answers</th>
                    <th className="py-3 px-6 border border-gray-300 text-left text-base font-semibold text-gray-800">Max Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  {stage.scoreKey.map((row) => (
                    <tr key={row.rowNumber} className={row.rowNumber % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                      <td className="py-3 px-6 border border-gray-300 text-gray-800 font-medium text-lg">{row.rowNumber}</td>
                      <td className="py-3 px-6 border border-gray-300">
                        {row.answers.length > 0 ? (
                          <div className="flex space-x-3">
                            {row.answers.map((answer, index) => (
                              <div
                                key={index}
                                className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-md shadow-sm border border-green-200"
                              >
                                <span className="text-xl font-bold text-green-800">{answer}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-600 text-base font-medium">No answers</span>
                        )}
                      </td>
                      <td className="py-3 px-6 border border-gray-300">
                        {row.falseAnswers && row.falseAnswers.length > 0 ? (
                          <div className="flex space-x-3">
                            {row.falseAnswers.map((fa, index) => (
                              <div key={index} className="flex items-center">
                                <span className="text-sm text-gray-600 mr-1">Col {fa.column + 1}:</span>
                                <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-md shadow-sm border border-red-200">
                                  <span className="text-xl font-bold text-red-800">{fa.value}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-600 text-base font-medium">No false answers</span>
                        )}
                      </td>
                      <td className="py-3 px-6 border border-gray-300">
                        <div className="w-12 h-10 flex items-center justify-center bg-blue-100 rounded-md shadow-sm border border-blue-200">
                          <span className="text-xl font-bold text-blue-800">{row.maxPenalty || 0}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex space-x-4">
          <Link href={`/rallies/${rallyId}`} className="text-blue-600 hover:underline text-lg font-medium">
            &larr; Back to Rally
          </Link>
          <Link
            href={`/rallies/${rallyId}/stages/${stage._id}/edit`}
            className="text-indigo-600 hover:underline text-lg font-medium"
          >
            Edit Stage
          </Link>
        </div>
      </div>
    </div>
  );
}
