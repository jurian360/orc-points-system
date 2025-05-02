import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { Quiz } from '../../../models';
import mongoose from 'mongoose';

// type Params = {
//   params: {
//     id: string;
//   };
// };

export async function GET(request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    await dbConnect();
    
    const { id } = await context.params
    // Access the id directly from the context object
    //const id = context.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid quiz ID' }, { status: 400 });
    }
    
    const quiz = await Quiz.findById(id);
    
    if (!quiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }
    
    return NextResponse.json(quiz);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch quiz' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    await dbConnect();
    
    // Access the id directly from the context object
    const id = context.params.id;
    const body = await request.json();
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid quiz ID' }, { status: 400 });
    }
    
    // Prepare the scoreKey with all the required fields
    const processedScoreKey = body.scoreKey.map((row: any) => ({
      rowNumber: row.rowNumber,
      answers: row.answers || [],
      falseAnswers: row.falseAnswers || [],
      maxPenalty: typeof row.maxPenalty === 'number' ? row.maxPenalty : 0
    }));
    
    const updatedQuiz = await Quiz.findByIdAndUpdate(
      id,
      { 
        name: body.name,
        scoreKey: processedScoreKey
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedQuiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }
    
    return NextResponse.json(updatedQuiz);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update quiz' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    await dbConnect();
    
    // Access the id directly from the context object
    const id = context.params.id;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid quiz ID' }, { status: 400 });
    }
    
    const deletedQuiz = await Quiz.findByIdAndDelete(id);
    
    if (!deletedQuiz) {
      return NextResponse.json({ error: 'Quiz not found' }, { status: 404 });
    }
    
    return NextResponse.json({ message: 'Quiz deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete quiz' }, { status: 500 });
  }
}