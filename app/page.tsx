import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold mb-8 text-center">ORC Points System</h1>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href="/quizzes" className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">Manage Quizzes</h2>
            <p className="text-gray-600">Create, view, edit, and delete quizzes and their score keys.</p>
          </Link>
          
          <Link href="/participants" className="block p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-xl font-semibold mb-2">Participant Answers</h2>
            <p className="text-gray-600">Enter participant answers and view submissions.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}