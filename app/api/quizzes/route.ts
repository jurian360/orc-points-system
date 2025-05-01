import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { Quiz } from '../../models';

export async function GET() {
  try {
    await dbConnect();
    const quizzes = await Quiz.find({}).sort({ createdAt: -1 });
    return NextResponse.json(quizzes);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch quizzes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    await dbConnect();
    
    const quiz = new Quiz({
      name: body.name,
      scoreKey: body.scoreKey
    });
    
    const savedQuiz = await quiz.save();
    
    return NextResponse.json(savedQuiz, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create quiz' }, { status: 500 });
  }
}