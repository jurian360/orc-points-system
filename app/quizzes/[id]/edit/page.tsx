'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import ScoreKeyForm from '../../../components/ScoreKeyForm';

interface Quiz {
  _id: string;
  name: string;
  scoreKey: {
    rowNumber: number;
    answers: string[];
    falseAnswers?: { column: number; value: string }[];
    maxPenalty?: number;
  }[];
  timeScoreKey?: {
    rowNumber: number;
    ipt: string;
    wpt: string;
    plusMinus: string;
    maxPenalty?: number;
  }[];
  merkScoreKey?: {
    rowNumber: number;
    merk: string;
    maxPenalty?: number;
  }[];
}

export default function EditQuizPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quizId, setQuizId] = useState<string>('');

  // Resolve params first
  useEffect(() => {
    const getParams = async () => {
      const resolvedParams = await params;
      setQuizId(resolvedParams.id);
    };
    getParams();
  }, [params]);

  useEffect(() => {
    if (!quizId) return;

    const fetchQuiz = async () => {
      try {
        const response = await fetch(`/api/quizzes/${quizId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch quiz');
        }
        
        const data = await response.json();
        setQuiz(data);
      } catch (err) {
        setError('Failed to load quiz. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuiz();
  }, [quizId]);

  const handleSubmit = async (
    quizName: string,
    scoreKey: any[],
    timeScoreKey: any[],
    merkScoreKey: any[]
  ) => {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/quizzes/${quizId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: quizName,
          scoreKey: scoreKey,
          timeScoreKey: timeScoreKey,
          merkScoreKey: merkScoreKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update quiz');
      }

      // Navigate back to the quizzes list page
      router.push('/quizzes');
    } catch (err) {
      setError('Failed to update quiz. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading quiz...</p>
      </div>
    );
  }

  if (error && !quiz) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link href="/quizzes" className="text-blue-600 hover:underline">
            Back to Quizzes
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Edit Quiz</h1>
          <p className="text-gray-600 mt-2">
            Edit the quiz name and score key.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {quiz && (
            <ScoreKeyForm 
              onSubmit={handleSubmit} 
              initialData={quiz} 
              isEditing={true} 
            />
          )}
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
            <p className="text-lg">Updating quiz...</p>
          </div>
        </div>
      )}
    </div>
  );
}