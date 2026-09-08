import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-grow flex items-center justify-center py-12">
        <div className="max-w-5xl w-full mx-auto px-6">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">SARK Points System</h1>
            <p className="text-xl text-gray-600 max-w-3xl mx-auto">
              Manage rallies, their stages and answer keys, and score participant answer sheets to
              rank the standings by total penalty points.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-1 gap-8">
            <Link href="/rallies" className="block p-8 bg-white rounded-xl shadow-lg hover:shadow-xl transition-shadow border border-gray-100">
              <div className="flex flex-col h-full">
                <h2 className="text-2xl font-bold mb-4 text-blue-700">Manage Rallies</h2>
                <p className="text-lg text-gray-600 mb-6">
                  Create a rally, add its stages (each with its own answer key), enter participant
                  answer sheets, and view the standings.
                </p>
                <div className="mt-auto">
                  <span className="px-4 py-2 bg-blue-600 text-white rounded-md inline-block font-medium">Get Started</span>
                </div>
              </div>
            </Link>
          </div>

          <div className="mt-12 bg-white rounded-xl shadow-lg p-8 border border-gray-100">
            <h2 className="text-2xl font-bold mb-4 text-gray-800">How to Use</h2>
            <ol className="list-decimal pl-6 space-y-4 text-lg text-gray-600">
              <li>First, create a rally and give it a name.</li>
              <li>Add one or more stages to the rally, each with its own answer key.</li>
              <li>Enter participant answer sheets for each stage. A participant can have one sheet per stage.</li>
              <li>View the standings — the winner is the participant with the lowest total penalty points across all their answer sheets.</li>
            </ol>
          </div>
        </div>
      </div>

      <footer className="bg-gray-800 text-white py-6">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-lg">SARK Points System &copy; {new Date().getFullYear()}</p>
        </div>
      </footer>
    </div>
  );
}
