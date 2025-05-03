'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import ParticipantForm from '../components/ParticipantForm';

interface Quiz {
  _id: string;
  name: string;
}

interface Participant {
  _id: string;
  eq: number;
  quizId: string;
  quizName?: string;
  submittedAt: string;
}

export default function ParticipantsPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [selectedQuizId, setSelectedQuizId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const fetchQuizzes = async () => {
      try {
        const response = await fetch('/api/quizzes');
        
        if (!response.ok) {
          throw new Error('Failed to fetch quizzes');
        }
        
        const data = await response.json();
        setQuizzes(data);
        
        // If we have quizzes, select the first one by default
        if (data.length > 0 && !selectedQuizId) {
          setSelectedQuizId(data[0]._id);
        }
      } catch (err) {
        setError('Failed to load quizzes. Please try again later.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchQuizzes();
  }, [selectedQuizId]);

  useEffect(() => {
    if (selectedQuizId) {
      fetchParticipants(selectedQuizId);
    }
  }, [selectedQuizId]);

  const fetchParticipants = async (quizId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/participants?quizId=${quizId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch participants');
      }
      
      const data = await response.json();
      
      // Add quiz name to each participant record
      const participantsWithQuizName = data.map((participant: any) => {
        const quiz = quizzes.find(q => q._id === participant.quizId);
        return {
          ...participant,
          quizName: quiz ? quiz.name : 'Unknown Quiz'
        };
      });
      
      setParticipants(participantsWithQuizName);
    } catch (err) {
      setError('Failed to load participants. Please try again later.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitParticipant = async (participantData: any) => {
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/participants', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(participantData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit participant answers');
      }

      setSuccess('Participant answers submitted successfully!');
      
      // Refresh the participants list
      if (selectedQuizId) {
        fetchParticipants(selectedQuizId);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit participant answers. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteParticipant = async (participantId: string) => {
    if (!window.confirm('Are you sure you want to delete this participant\'s answers? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/participants/${participantId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete participant answers');
      }

      // Remove the deleted participant from the state
      setParticipants(participants.filter(p => p._id !== participantId));
      setSuccess('Participant answers deleted successfully!');
    } catch (err) {
      setError('Failed to delete participant answers. Please try again.');
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

  const handleQuizChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedQuizId(e.target.value);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-3">Participant Answers</h1>
          <p className="text-gray-700 text-xl">
            Enter and manage participant answers for quizzes.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border-l-4 border-red-500 text-red-700 px-8 py-5 rounded-lg mb-8 text-lg font-medium shadow-md">
            <p>{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-100 border-l-4 border-green-500 text-green-800 px-8 py-5 rounded-lg mb-8 text-lg font-medium shadow-md">
            <p>{success}</p>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-12">
          <div className="p-8 border-b-2 border-gray-200">
            <h2 className="text-3xl font-bold mb-4 text-gray-800">Enter New Participant Answers</h2>
          </div>
          <div className="p-8">
            {quizzes.length === 0 ? (
              <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <p className="mb-6 text-xl text-gray-700">No quizzes available. Create a quiz first.</p>
                <Link 
                  href="/quizzes/new" 
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block text-lg font-bold shadow-md"
                >
                  Create New Quiz
                </Link>
              </div>
            ) : (
              <ParticipantForm 
                onSubmit={handleSubmitParticipant} 
                quizzes={quizzes} 
              />
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-12">
          <div className="p-8 border-b-2 border-gray-200">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <h2 className="text-3xl font-bold text-gray-800">Submitted Answers</h2>
              {quizzes.length > 0 && (
                <div className="flex items-center">
                  <label htmlFor="quizFilter" className="mr-4 text-xl text-gray-700 font-medium">Filter by Quiz:</label>
                  <select
                    id="quizFilter"
                    className="border-2 border-gray-300 rounded-lg p-3 text-lg shadow-sm bg-white min-w-[200px] font-medium"
                    value={selectedQuizId}
                    onChange={handleQuizChange}
                  >
                    {quizzes.map((quiz) => (
                      <option key={quiz._id} value={quiz._id}>
                        {quiz.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>
          
          <div className="p-8">
            {loading ? (
              <div className="text-center p-12">
                <div className="animate-pulse flex justify-center">
                  <div className="h-8 w-8 bg-blue-600 rounded-full"></div>
                  <div className="h-8 w-8 bg-blue-600 rounded-full ml-1 animate-pulse delay-75"></div>
                  <div className="h-8 w-8 bg-blue-600 rounded-full ml-1 animate-pulse delay-150"></div>
                </div>
                <p className="text-xl text-gray-600 mt-4">Loading participant data...</p>
              </div>
            ) : participants.length === 0 ? (
              <div className="text-center p-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <p className="text-xl text-gray-700">No participant answers found for the selected quiz.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y-2 divide-gray-200 border-2 border-gray-200 rounded-lg">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Participant ID
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Quiz
                      </th>
                      <th className="px-8 py-5 text-left text-base font-bold text-gray-800 uppercase border-b-2 border-r-2 border-gray-200">
                        Submitted At
                      </th>
                      <th className="px-8 py-5 text-right text-base font-bold text-gray-800 uppercase border-b-2 border-gray-200">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {participants.map((participant) => (
                      <tr key={participant._id} className="hover:bg-gray-50">
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-2xl font-bold text-gray-900">
                            {participant.eq}
                          </div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg text-gray-700">
                            {participant.quizName}
                          </div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap border-r-2 border-gray-200">
                          <div className="text-lg text-gray-700">
                            {formatDate(participant.submittedAt)}
                          </div>
                        </td>
                        <td className="px-8 py-5 whitespace-nowrap text-right">
                          <div className="flex justify-end space-x-3">
                            <Link
                              href="/participant-answers"
                              className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 font-medium text-lg transition-colors"
                            >
                              View Score
                            </Link>
                            <button
                              onClick={() => handleDeleteParticipant(participant._id)}
                              className="px-4 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 font-medium text-lg transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="mt-8">
          <Link 
            href="/" 
            className="inline-flex items-center px-5 py-3 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg text-lg font-medium transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
            Back to Home
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full">
            <div className="animate-spin h-12 w-12 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-2xl font-bold text-center text-gray-800">Submitting answers...</p>
            <p className="text-gray-600 text-center mt-2">Please wait while we process your submission.</p>
          </div>
        </div>
      )}
    </div>
  );
}