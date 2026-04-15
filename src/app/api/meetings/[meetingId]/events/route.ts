// src/app/api/meetings/[meetingId]/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { ingestTranscriptEvent, getMeeting } from '@/lib/meeting-store';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  try {
    const { meetingId } = await params;
    const body = await request.json();
    const { speakerName, text, language, isFinal, translatedText } = body;

    console.log('[Events API] 收到请求:', { 
      meetingId, 
      speakerName, 
      text: text?.substring(0, 50),
      hasTranslation: !!translatedText
    });

    // 使用 meeting-store 中的函数处理转录事件
    // 这会自动触发情绪分析、行动项提取等
    const updatedMeeting = await ingestTranscriptEvent(meetingId, {
      speakerName,
      text,
      language: language || 'auto',
      isFinal: isFinal ?? true,
      translatedText: translatedText || '',
    });

    if (!updatedMeeting) {
      // 会议不存在，尝试创建一个新的
      console.log('[Events API] 会议不存在，自动创建:', meetingId);
      const { createMeeting } = await import('@/lib/meeting-store');
      const newMeeting = createMeeting('新会议');
      // 重新调用一次
      const result = await ingestTranscriptEvent(meetingId, {
        speakerName,
        text,
        language: language || 'auto',
        isFinal: isFinal ?? true,
        translatedText: translatedText || '',
      });
      return NextResponse.json({ meeting: result, success: true });
    }

    console.log('[Events API] 已添加转录，当前总数:', updatedMeeting.transcript.length);
    
    return NextResponse.json({ meeting: updatedMeeting, success: true });
  } catch (error) {
    console.error('[Events API] 错误:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 }
    );
  }
}