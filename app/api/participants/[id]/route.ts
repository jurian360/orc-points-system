import { NextRequest, NextResponse } from 'next/server';
import dbConnect from '../../../lib/mongodb';
import { ParticipantAnswer } from '../../../models';
import mongoose from 'mongoose';

type Params = {
  params: {
    id: string;
  };
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect();
    
    // Properly access the id after awaiting the params
    const { id } = await params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid participant answer ID' }, { status: 400 });
    }
    
    const participantAnswer = await ParticipantAnswer.findById(id);
    
    if (!participantAnswer) {
      return NextResponse.json({ error: 'Participant answer not found' }, { status: 404 });
    }
    
    return NextResponse.json(participantAnswer);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch participant answer' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, context: Params) {
  try {
    await dbConnect();
    
    // Properly access the id after awaiting the params
    const { id } = context.params;
    const body = await request.json();
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid participant answer ID' }, { status: 400 });
    }
    
    const updatedAnswer = await ParticipantAnswer.findByIdAndUpdate(
      id,
      { 
        eq: body.eq,
        answers: body.answers 
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedAnswer) {
      return NextResponse.json({ error: 'Participant answer not found' }, { status: 404 });
    }
    
    return NextResponse.json(updatedAnswer);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update participant answer' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    await dbConnect();
    
    // Properly access the id after awaiting the params
    const { id } = context.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid participant answer ID' }, { status: 400 });
    }
    
    const deletedAnswer = await ParticipantAnswer.findByIdAndDelete(id);
    
    if (!deletedAnswer) {
      return NextResponse.json({ error: 'Participant answer not found' }, { status: 404 });
    }
    
    return NextResponse.json({ message: 'Participant answer deleted successfully' });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete participant answer' }, { status: 500 });
  }
}