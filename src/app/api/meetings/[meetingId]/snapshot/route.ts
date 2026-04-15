// src/app/api/meetings/[meetingId]/snapshot/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getMeeting } from '@/lib/meeting-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    let meeting = getMeeting(meetingId);
    
    if (!meeting) {
      console.log('[Snapshot API] 会议不存在，返回空会议:', meetingId);
      const { createMeeting } = await import('@/lib/meeting-store');
      meeting = createMeeting('新会议');
    }
    
    return NextResponse.json({ meeting });
  } catch (error) {
    console.error('[Snapshot API] 错误:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}