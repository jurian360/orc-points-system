import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-grow flex items-center justify-center py-12">
        <div className="max-w-5xl w-full mx-auto px-6">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">ORC Points System</h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              A complete system for managing quiz score keys and participant answers with the ability to apply penalty points.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <Link href="/quizzes" className="block p-8 bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
              <div className="flex flex-col h-full">
                <h2 className="text-2xl font-bold mb-4 text-blue-700">Manage Quizzes</h2>
                <p className="text-lg text-gray-600 mb-6">Create, view, edit, and delete quizzes and their score keys. Each quiz has 40 rows with 4 possible answers per row.</p>
                <div className="mt-auto">
                  <span className="px-4 py-2 bg-blue-600 text-white rounded-md inline-block font-medium">Get Started</span>
                </div>
              </div>
            </Link>
            
            <Link href="/participants" className="block p-8 bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
              <div className="flex flex-col h-full">
                <h2 className="text-2xl font-bold mb-4 text-green-700">Participant Answers</h2>
                <p className="text-lg text-gray-600 mb-6">Enter participant answers and view submissions. Each participant has a unique ID between 1 and 100.</p>
                <div className="mt-auto">
                  <span className="px-4 py-2 bg-green-600 text-white rounded-md inline-block font-medium">Enter Answers</span>
                </div>
              </div>
            </Link>
          </div>
          
          <div className="mt-12 bg-white rounded-xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">How to Use</h2>
            <ol className="list-decimal pl-6 space-y-4 text-lg text-gray-600">
              <li>First, create a quiz with a name and score key for each row.</li>
              <li>Enter participant answers by selecting the quiz and providing the participant ID.</li>
              <li>View and manage all quizzes and participant submissions from their respective pages.</li>
              <li>In the future, penalty points calculation will be available.</li>
            </ol>
          </div>
        </div>
      </div>
      
      <footer className="bg-gray-800 text-white py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-lg">ORC Points System &copy; {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}