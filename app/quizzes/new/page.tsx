'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ScoreKeyForm from '../../components/ScoreKeyForm';

export default function NewQuizPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (quizName: string, scoreKey: any[]) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/quizzes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: quizName,
          scoreKey: scoreKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create quiz');
      }

      // Navigate back to the quizzes list page
      router.push('/quizzes');
    } catch (err) {
      setError('Failed to create quiz. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Create New Quiz</h1>
          <p className="text-gray-600 mt-2">
            Enter the quiz name and score key for a new quiz.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          <ScoreKeyForm onSubmit={handleSubmit} />
        </div>

        <div className="mt-6">
          <Link href="/quizzes" className="text-blue-600 hover:underline">
            &larr; Back to Quizzes
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg">
            <p className="text-lg">Creating quiz...</p>
          </div>
        </div>
      )}
    </div>
  );
}