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
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto p-4">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Participant Answers</h1>
          <p className="text-gray-600 mt-2">
            Enter and manage participant answers for quizzes.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
            {success}
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden mb-8">
          <div className="p-6">
            <h2 className="text-lg font-semibold mb-4">Enter New Participant Answers</h2>
            {quizzes.length === 0 ? (
              <div className="text-center p-4">
                <p className="mb-4">No quizzes available. Create a quiz first.</p>
                <Link 
                  href="/quizzes/new" 
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
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

        <div className="bg-white rounded-lg shadow overflow-hidden mb-6">
          <div className="p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Submitted Answers</h2>
              {quizzes.length > 0 && (
                <div className="flex items-center">
                  <label htmlFor="quizFilter" className="mr-2">Filter by Quiz:</label>
                  <select
                    id="quizFilter"
                    className="border rounded p-2"
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
            
            {loading ? (
              <div className="text-center p-4">Loading...</div>
            ) : participants.length === 0 ? (
              <div className="text-center p-4">
                <p>No participant answers found for the selected quiz.</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Participant ID
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quiz
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Submitted At
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {participants.map((participant) => (
                    <tr key={participant._id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">
                          {participant.eq}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {participant.quizName}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-500">
                          {formatDate(participant.submittedAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button
                          onClick={() => handleDeleteParticipant(participant._id)}
                          className="text-red-600 hover:text-red-900"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="mt-6">
          <Link href="/" className="text-blue-600 hover:underline">
            &larr; Back to Home
          </Link>
        </div>
      </div>

      {submitting && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
          <div className="bg-white p-4 rounded-lg">
            <p className="text-lg">Submitting answers...</p>
          </div>
        </div>
      )}
    </div>
  );
}