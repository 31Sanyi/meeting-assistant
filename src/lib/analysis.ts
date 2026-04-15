import { generateSummaryWithLlm } from "@/lib/llm-client";
import { ActionItem, Meeting, MeetingSummary, SentimentLabel, SentimentMoment, TranscriptSegment } from "@/types/meeting";

// ========== 情绪分析（旧版：调用 LLM）==========
function getApiUrl(path: string): string {
  if (typeof window !== 'undefined') return path;
  let baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    if (process.env.NODE_ENV === 'development') {
      baseUrl = 'http://localhost:3000';
    } else {
      throw new Error('NEXT_PUBLIC_APP_URL is not set in production');
    }
  }
  return `${baseUrl}${path}`;
}

export async function detectSentiment(segment: TranscriptSegment): Promise<SentimentMoment | null> {
  if (!segment.isFinal) return null;
  if (segment.text.trim().length < 3) {
    return {
      id: crypto.randomUUID(),
      meetingId: segment.meetingId,
      label: "neutral",
      intensity: 0.5,
      sourceSegmentId: segment.id,
      evidenceText: segment.text,
      createdAt: new Date().toISOString(),
    };
  }

  try {
    const url = getApiUrl('/api/llm/sentiment');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: segment.text })
    });
    const data = await response.json();
    return {
      id: crypto.randomUUID(),
      meetingId: segment.meetingId,
      label: data.sentiment as SentimentLabel,
      intensity: data.confidence,
      sourceSegmentId: segment.id,
      evidenceText: segment.text,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[情绪分析] 调用失败:', error);
    return {
      id: crypto.randomUUID(),
      meetingId: segment.meetingId,
      label: "neutral",
      intensity: 0.5,
      sourceSegmentId: segment.id,
      evidenceText: segment.text,
      createdAt: new Date().toISOString(),
    };
  }
}

// ========== 行动项规则匹配（旧版）==========
const ACTION_PATTERNS = [
  /(我|I)\s*(会|will)\s*(在|by)?\s*(周[一二三四五六日天]|Friday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\d{4}-\d{2}-\d{2})?.{0,20}(发送|提交|完成|整理|follow up|send|deliver|prepare)/i,
  /(请|please).{0,18}(你|you).{0,18}(完成|处理|跟进|review|update|fix)/i,
  /(action item|todo|待办|后续)/i,
];

export function inferDueDate(text: string): string | null {
  const m = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (m?.[1]) return `${m[1]}T17:00:00.000Z`;
  if (/周五|Friday/i.test(text)) return "Friday";
  if (/明天|tomorrow/i.test(text)) return "tomorrow";
  return null;
}

export function extractActionItems(segment: TranscriptSegment): ActionItem[] {
  const matched = ACTION_PATTERNS.some((pattern) => pattern.test(segment.text));
  if (!matched) return [];

  const owner = segment.speakerName || null;
  const dueDate = inferDueDate(segment.text);

  return [
    {
      id: crypto.randomUUID(),
      meetingId: segment.meetingId,
      description: segment.text,
      owner,
      dueDate,
      sourceSegmentId: segment.id,
      confidence: dueDate ? 0.9 : 0.75,
      status: "pending_confirmation",
    },
  ];
}

// ========== 摘要和行动项 LLM（新版：长摘要 + briefPoints + actionItems）==========
function mergeStringLists(prev: string[], incoming: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...prev, ...incoming]) {
    const t = s?.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeComparable(s: string): string {
  return s.trim().toLowerCase().replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ").trim();
}

function stringsLikelyDuplicate(a: string, b: string): boolean {
  const na = normalizeComparable(a);
  const nb = normalizeComparable(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = na.replace(/\s/g, "");
  const cb = nb.replace(/\s/g, "");
  if (ca === cb) return true;
  const short = ca.length <= cb.length ? ca : cb;
  const long = ca.length <= cb.length ? cb : ca;
  if (short.length >= 4 && long.includes(short)) return true;
  return false;
}

export function dedupeSimilarStrings(items: string[], mode: "topic" | "sentence"): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const t = raw?.trim();
    if (!t) continue;
    const dupIdx = out.findIndex((e) => stringsLikelyDuplicate(e, t));
    if (dupIdx >= 0) {
      if (t.length > out[dupIdx].length) out[dupIdx] = t;
      continue;
    }
    out.push(t);
  }
  return out;
}

export function stripSummaryListOrdinalPrefix(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^\d{1,2}(?:[\.、．:：]|[\)）\]])[\s\u3000]*/u, "").trim();
  s = s.replace(/^(?:第一|第二|第三|第四|第五)[，,：:、．.）)\s]+/u, "").trim();
  return s;
}

export function mergeMeetingSummaries(prev: MeetingSummary, incoming: MeetingSummary): MeetingSummary {
  const incomingText = incoming.summaryText?.trim() ?? "";
  const summaryText = incomingText || prev.summaryText?.trim() || "";

  const topicsMerged = mergeStringLists(prev.topics ?? [], incoming.topics ?? [], 20);
  const briefMerged = mergeStringLists(
    (prev.briefPoints ?? []).map(stripSummaryListOrdinalPrefix),
    (incoming.briefPoints ?? []).map(stripSummaryListOrdinalPrefix),
    14,
  );
  const risksMerged = mergeStringLists(
    (prev.risks ?? []).map(stripSummaryListOrdinalPrefix),
    (incoming.risks ?? []).map(stripSummaryListOrdinalPrefix),
    16,
  );

  return {
    summaryText: summaryText || undefined,
    topics: dedupeSimilarStrings(topicsMerged, "topic").slice(0, 6),
    briefPoints: dedupeSimilarStrings(briefMerged, "sentence").slice(0, 6),
    decisions: mergeStringLists(prev.decisions ?? [], incoming.decisions ?? [], 14),
    risks: dedupeSimilarStrings(risksMerged, "sentence").slice(0, 4),
    nextActions: mergeStringLists(prev.nextActions ?? [], incoming.nextActions ?? [], 22),
    updatedAt: new Date().toISOString(),
  };
}

export function updateSummary(meeting: Meeting, latestSegment: TranscriptSegment): MeetingSummary {
  const prev = meeting.summary;
  return {
    summaryText: prev.summaryText,
    topics: prev.topics,
    briefPoints: prev.briefPoints,
    decisions: prev.decisions,
    risks: prev.risks,
    nextActions: prev.nextActions,
    updatedAt: new Date().toISOString(),
  };
}

export async function updateSummaryWithLlmOrFallback(
  meeting: Meeting,
  transcriptWindow: TranscriptSegment[],
  options?: { preferChineseOutput?: boolean }
): Promise<{ summary: MeetingSummary; actionItems: Array<{ owner: string; due: string | null; description: string }> | null }> {
  const previousSummary = JSON.stringify({
    summaryText: meeting.summary.summaryText ?? "",
    briefPoints: meeting.summary.briefPoints ?? [],
    topics: meeting.summary.topics ?? [],
    decisions: meeting.summary.decisions ?? [],
    nextActions: meeting.summary.nextActions ?? [],
    risks: meeting.summary.risks ?? [],
  });

  const windowLines = transcriptWindow.slice(-80).map((s) => `${s.speakerName}: ${s.text}`);
  let llm = null;
  try {
    llm = await generateSummaryWithLlm({
      transcriptWindow: windowLines,
      previousSummary,
      preferChineseOutput: options?.preferChineseOutput,
    });
  } catch {
    llm = null;
  }
  
  if (!llm) {
    return { summary: meeting.summary, actionItems: null };
  }

  const incoming: MeetingSummary = {
    summaryText: llm.summaryText,
    topics: (llm.topics ?? []).slice(0, 12),
    briefPoints: (llm.briefPoints ?? []).slice(0, 6),
    decisions: (llm.decisions ?? []).slice(0, 12),
    risks: (llm.risks ?? []).slice(0, 12),
    nextActions: (llm.nextActions ?? []).slice(0, 22),
    updatedAt: new Date().toISOString(),
  };

  return {
    summary: mergeMeetingSummaries(meeting.summary, incoming),
    actionItems: llm.actionItems?.slice(0, 12) || null,
  };
}