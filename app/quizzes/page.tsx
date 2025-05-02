'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';

interface Quiz {
  _id: string;
  name: string;
  createdAt: string;
}

export default function QuizzesPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const response = await fetch('/api/quizzes');
        
        if (!response.ok) {
          throw new Error('Failed to fetch quizzes');
        }
        
        const data = await response.json();
        setQuizzes(data);
      } catch (err) {
        setError('Failed to load quizzes. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuizzes();
  }, []);

  const handleDeleteQuiz = async (quizId: string) => {
    if (!window.confirm('Are you sure you want to delete this quiz? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/quizzes/${quizId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete quiz');
      }

      // Remove the deleted quiz from the state
      setQuizzes(quizzes.filter(quiz => quiz._id !== quizId));
    } catch (err) {
      alert('Failed to delete quiz. Please try again.');
      console.error(err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800">Quiz Management</h1>
          <Link 
            href="/quizzes/new" 
            className="px-5 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-lg font-medium shadow-md transition duration-150"
          >
            Create New Quiz
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          {loading ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600">Loading quizzes...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center">
              <p className="text-lg text-red-600 font-medium">{error}</p>
            </div>
          ) : quizzes.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-lg text-gray-600 mb-4">No quizzes found. Create your first quiz to get started.</p>
              <Link 
                href="/quizzes/new" 
                className="px-5 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 inline-block"
              >
                Create New Quiz
              </Link>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Quiz Name
                  </th>
                  <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Created At
                  </th>
                  <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {quizzes.map((quiz) => (
                  <tr key={quiz._id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-lg font-medium text-gray-900">{quiz.name}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-base text-gray-600">{formatDate(quiz.createdAt)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <div className="flex justify-end space-x-4">
                        <Link
                          href={`/quizzes/${quiz._id}`}
                          className="text-blue-600 hover:text-blue-900 font-medium text-base"
                        >
                          View
                        </Link>
                        <Link
                          href={`/quizzes/${quiz._id}/edit`}
                          className="text-indigo-600 hover:text-indigo-900 font-medium text-base"
                        >
                          Edit
                        </Link>
                        <button
                          onClick={() => handleDeleteQuiz(quiz._id)}
                          className="text-red-600 hover:text-red-900 font-medium text-base"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="mt-8">
          <Link href="/" className="text-blue-600 hover:underline text-lg font-medium">
            &larr; Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}