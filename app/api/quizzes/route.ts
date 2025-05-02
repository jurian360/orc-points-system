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
    
    // Prepare the scoreKey with all the required fields
    const processedScoreKey = body.scoreKey.map((row: any) => ({
      rowNumber: row.rowNumber,
      answers: row.answers || [],
      falseAnswers: row.falseAnswers || [],
      maxPenalty: typeof row.maxPenalty === 'number' ? row.maxPenalty : 0
    }));
    
    const quiz = new Quiz({
      name: body.name,
      scoreKey: processedScoreKey
    });
    
    const savedQuiz = await quiz.save();
    
    return NextResponse.json(savedQuiz, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create quiz' }, { status: 500 });
  }
}