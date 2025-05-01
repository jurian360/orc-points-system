'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Quiz {
  _id: string;
  name: string;
  createdAt: string;
  scoreKey: {
    rowNumber: number;
    answers: string[];
  }[];
}

export default function ViewQuizPage({ params }: { params: { id: string } }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchQuiz = async () => {
      try {
        const response = await fetch(`/api/quizzes/${params.id}`);
        
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
  }, [params.id]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p>Loading quiz...</p>
      </div>
    );
  }

  if (error || !quiz) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Quiz not found'}</p>
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
          <h1 className="text-2xl font-bold">{quiz.name}</h1>
          <p className="text-gray-600 mt-2">
            Created: {formatDate(quiz.createdAt)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Score Key</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="py-2 px-4 border-b text-left">Row</th>
                    <th className="py-2 px-4 border-b text-left">Answers</th>
                  </tr>
                </thead>
                <tbody>
                  {quiz.scoreKey.map((row) => (
                    <tr key={row.rowNumber} className={(row.rowNumber % 2 === 0) ? 'bg-gray-50' : 'bg-white'}>
                      <td className="py-2 px-4 border-b font-medium">{row.rowNumber}</td>
                      <td className="py-2 px-4 border-b">
                        {row.answers.length > 0 ? (
                          <div className="flex space-x-2">
                            {row.answers.map((answer, index) => (
                              <div key={index} className="w-8 h-8 flex items-center justify-center bg-gray-100 rounded">
                                {answer}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500">No answers</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex space-x-4">
          <Link href="/quizzes" className="text-blue-600 hover:underline">
            &larr; Back to Quizzes
          </Link>
          <Link 
            href={`/quizzes/${quiz._id}/edit`}
            className="text-indigo-600 hover:underline"
          >
            Edit Quiz
          </Link>
        </div>
      </div>
    </div>
  );
}