import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ORC Points System",
  description: "Manage quiz answers and scoring",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}
      >
        <nav className="bg-blue-600 shadow-md">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16">
              <div className="flex">
                <div className="flex-shrink-0 flex items-center">
                  <a href="/" className="text-white text-xl font-bold">ORC Points System</a>
                </div>
                <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                  <a
                    href="/"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Home
                  </a>
                  <a
                    href="/quizzes"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Quizzes
                  </a>
                  <a
                    href="/participants"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Participants
                  </a>
                  <a
                    href="/participant-answers"
                    className="text-white hover:text-blue-200 px-3 py-2 rounded-md text-sm font-medium"
                  >
                    Participant Scoring
                  </a>
                </div>
              </div>
            </div>
          </div>
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}