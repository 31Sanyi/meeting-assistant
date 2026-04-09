import { detectSentiment, extractActionItems, updateSummaryWithLlmOrFallback } from "@/lib/analysis";
import { IngestEventInput, Meeting, TranscriptSegment } from "@/types/meeting";

const meetings = new Map<string, Meeting>();
const llmLastRunAtMsByMeeting = new Map<string, number>();

function createEmptyMeeting(id: string, title: string): Meeting {
  const now = new Date().toISOString();
  return {
    id,
    title,
    createdAt: now,
    participants: [],
    transcript: [],
    actions: [],
    sentiments: [],
    summary: {
      topics: [],
      decisions: [],
      risks: [],
      nextActions: [],
      updatedAt: now,
    },
  };
}

export function createMeeting(title: string): Meeting {
  const id = `m_${crypto.randomUUID()}`;
  const meeting = createEmptyMeeting(id, title);
  meetings.set(id, meeting);
  return meeting;
}

export function getMeeting(id: string): Meeting | null {
  return meetings.get(id) ?? null;
}

export function listMeetings(): Meeting[] {
  return Array.from(meetings.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function ingestTranscriptEvent(meetingId: string, input: IngestEventInput): Promise<Meeting | null> {
  const meeting = meetings.get(meetingId);
  if (!meeting) return null;

  const now = Date.now();
  const segment: TranscriptSegment = {
    id: `seg_${crypto.randomUUID()}`,
    meetingId,
    speakerId: input.speakerName.trim().toLowerCase().replace(/\s+/g, "-") || "unknown",
    speakerName: input.speakerName,
    text: input.text,
    language: input.language || "auto",
    startMs: now,
    endMs: now + 1200,
    isFinal: input.isFinal ?? true,
    createdAt: new Date().toISOString(),
  };

  meeting.transcript.push(segment);

  if (input.speakerName && !meeting.participants.find((p) => p.name === input.speakerName)) {
    meeting.participants.push({
      id: segment.speakerId,
      name: input.speakerName,
    });
  }

  const actionItems = extractActionItems(segment);
  if (actionItems.length) {
    meeting.actions.push(...actionItems);
  }

  const sentimentMoment = detectSentiment(segment);
  if (sentimentMoment) {
    meeting.sentiments.push(sentimentMoment);
  }

  const lastRun = llmLastRunAtMsByMeeting.get(meetingId) ?? 0;
  const shouldRunLlm = now - lastRun >= 3500;
  // Per project design: insights should be regenerated from the running meeting context.
  const transcriptWindow = meeting.transcript;

  if (shouldRunLlm) {
    llmLastRunAtMsByMeeting.set(meetingId, now);
    try {
      const { summary, actionItems } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
      meeting.summary = summary;

      if (actionItems?.length) {
        meeting.actions = actionItems.map((item) => ({
          id: crypto.randomUUID(),
          meetingId,
          description: item.description,
          owner: item.owner || null,
          dueDate: item.due,
          sourceSegmentId: segment.id,
          confidence: 0.85,
          status: "pending_confirmation" as const,
        }));
      }
    } catch {
      // Fall back to heuristics if LLM call fails.
      const { summary } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
      meeting.summary = summary;
    }
  } else {
    const { summary } = await updateSummaryWithLlmOrFallback(meeting, transcriptWindow);
    meeting.summary = summary;
  }
  return meeting;
}
