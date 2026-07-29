import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../lib/mongodb';
import { ParticipantAnswer, Quiz } from '../../models';
import mongoose from 'mongoose';

export async function GET(request: NextRequest) {
  try {
    await dbConnect();
    
    const { searchParams } = new URL(request.url);
    const quizId = searchParams.get('quizId');
    
    if (!quizId || !mongoose.Types.ObjectId.isValid(quizId)) {
      return NextResponse.json({ error: 'Valid quizId is required' }, { status: 400 });
    }
    
    const answers = await ParticipantAnswer.find({ quizId }).sort({ submittedAt: -1 });
    return NextResponse.json(answers);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch participant answers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    await dbConnect();
    
    // Validate quiz exists
    if (!mongoose.Types.ObjectId.isValid(body.quizId)) {
      return NextResponse.json({ error: 'Invalid quiz ID' }, { status: 400 });
    }
    
    const quiz = await Quiz.findById(body.quizId);
    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }
    
    // Check for existing participant with same EQ
    const existingParticipant = await ParticipantAnswer.findOne({
      eq: body.eq,
      quizId: body.quizId
    });
    
    if (existingParticipant) {
      return NextResponse.json(
        { error: 'A participant with this ID has already submitted answers for this quiz' },
        { status: 400 }
      );
    }
    
    const participantAnswer = new ParticipantAnswer({
      eq: body.eq,
      quizId: body.quizId,
      answers: body.answers,
      timePenalties: body.timePenalties || [],
      merkScores: body.merkScores || []
    });
    
    const savedAnswer = await participantAnswer.save();
    
    return NextResponse.json(savedAnswer, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save participant answers' }, { status: 500 });
  }
}