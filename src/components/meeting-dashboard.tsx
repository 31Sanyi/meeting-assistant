"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Meeting, SentimentLabel } from "@/types/meeting";
import { Activity, CheckCircle2, Mic, Sparkles, Users } from "lucide-react";
import { VoiceAssistant } from "@/components/voice-assistant";
import { generateSummaryWithLlm } from "@/lib/llm-client";
import {
  dedupeSimilarStrings,
  stripSummaryListOrdinalPrefix,
} from "@/lib/analysis";

// Sentiment icon and text mapping
const sentimentDisplay: Record<SentimentLabel, { icon: string; text: string }> = {
  positive: { icon: "😊", text: "Positive" },
  neutral: { icon: "😐", text: "Neutral" },
  negative: { icon: "😞", text: "Negative" },
  tension: { icon: "⚠️", text: "Tension" },
  hesitation: { icon: "🤔", text: "Hesitation" },
  agreement: { icon: "👍", text: "Agreement" },
  disagreement: { icon: "👎", text: "Disagreement" },
};

// Get sentiment by segmentId
function getSentimentForSegment(segmentId: string, sentiments: Meeting["sentiments"]): { icon: string; text: string } | null {
  const sentiment = sentiments.find(s => s.sourceSegmentId === segmentId);
  if (!sentiment) return null;
  return sentimentDisplay[sentiment.label] || null;
}

async function createMeeting(title: string) {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error("Failed to create meeting");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

async function translateText(text: string, targetLang: string = 'zh'): Promise<string | null> {
  if (!text || text.trim().length === 0) return null;
  
  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (targetLang === 'zh' && chineseRegex.test(text)) {
    return text;
  }
  
  try {
    const response = await fetch('/api/llm/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang })
    });
    const data = await response.json();
    return data.translation || null;
  } catch (error) {
    console.error('[Translate] Failed:', error);
    return null;
  }
}

async function postSegment(meetingId: string, speakerName: string, text: string, language: string, translatedText?: string, preferChineseSummary?: boolean) {
  const res = await fetch(`/api/meetings/${meetingId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speakerName, text, language, isFinal: true, translatedText, preferChineseSummary }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Failed to submit speech");
  }

  const data = await res.json();
  return data.meeting as Meeting;
}

async function fetchSnapshot(meetingId: string) {
  const res = await fetch(`/api/meetings/${meetingId}/snapshot`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch meeting snapshot");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

const ACTION_HINT_RE = /(明天|今天|今晚|后天|周[一二三四五六日天]|下周|本周|月底|before|by|tomorrow|tonight|next week|deadline|due|需要|负责|完成|提交|汇报|准备|please|need to|should|will)/i;

export function MeetingDashboard() {
  const initialTitleRef = useRef("Product Weekly - AI Assistant Demo");
  const meetingRef = useRef<Meeting | null>(null);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingTitle, setMeetingTitle] = useState(initialTitleRef.current);
  const [speakerName, setSpeakerName] = useState("Alice");
  const [language, setLanguage] = useState("zh");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [enableTranslation, setEnableTranslation] = useState(true);
  const enableTranslationRef = useRef(enableTranslation);
  const lastLlmCallTimeRef = useRef<number>(0);
  const LLM_INTERVAL_MS = 40000;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    meetingRef.current = meeting;
  }, [meeting]);

  useEffect(() => {
    enableTranslationRef.current = enableTranslation;
  }, [enableTranslation]);

  const displayTopics = useMemo(
    () =>
      dedupeSimilarStrings(
        (meeting?.summary.topics ?? []).map((t) => t.trim()).filter(Boolean),
        "topic",
      ).slice(0, 6),
    [meeting?.summary.topics],
  );

  const displayBriefPoints = useMemo(
    () =>
      dedupeSimilarStrings(
        (meeting?.summary.briefPoints ?? []).map((b) => stripSummaryListOrdinalPrefix(b)).filter(Boolean),
        "sentence",
      ).slice(0, 6),
    [meeting?.summary.briefPoints],
  );

  const displayRisks = useMemo(
    () =>
      dedupeSimilarStrings(
        (meeting?.summary.risks ?? []).map((r) => stripSummaryListOrdinalPrefix(r)).filter(Boolean),
        "sentence",
      ).slice(0, 4),
    [meeting?.summary.risks],
  );

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const created = await createMeeting(initialTitleRef.current);
        if (!cancelled) {
          setMeeting(created);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Initialization failed");
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmitSegment() {
    if (!meeting?.id || !text.trim()) return;

    setError(null);
    setIsSubmitting(true);
    try {
      let translatedText = '';
      if (enableTranslation && language === 'en') {
        const translation = await translateText(text.trim(), 'zh');
        translatedText = translation || '';
      }
      
      const updatedMeeting = await postSegment(meeting.id, speakerName, text.trim(), language, translatedText, enableTranslation);
      setMeeting(updatedMeeting);
      setText("");

      const transcriptTexts = updatedMeeting.transcript.map(
        seg => `${seg.speakerName}: ${seg.text}`
      );
      const latestText = updatedMeeting.transcript[updatedMeeting.transcript.length - 1]?.text ?? "";
      const now = Date.now();
      const timeSinceLastCall = now - lastLlmCallTimeRef.current;
      const hasServerSummary = updatedMeeting.summary?.topics?.length || updatedMeeting.summary?.decisions?.length || updatedMeeting.summary?.nextActions?.length || updatedMeeting.summary?.risks?.length;
      const shouldFastRefresh = ACTION_HINT_RE.test(latestText) && timeSinceLastCall >= 6000;

      if (
        transcriptTexts.length > 0 &&
        (!hasServerSummary || timeSinceLastCall >= LLM_INTERVAL_MS || shouldFastRefresh)
      ) {
        lastLlmCallTimeRef.current = now;
        await generateAndUpdateSummary(transcriptTexts);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  const generateAndUpdateSummary = async (transcriptTexts: string[]) => {
    if (isGeneratingSummary) return;
    
    if (!transcriptTexts || transcriptTexts.length === 0) {
      console.log('[LLM] No transcript content, skipping');
      return;
    }
    
    setIsGeneratingSummary(true);
    
    console.log('[LLM] Generating summary, total:', transcriptTexts.length);
    
    try {
      const prevSnap = meetingRef.current;
      const result = await generateSummaryWithLlm({
        transcriptWindow: transcriptTexts,
        previousSummary: prevSnap
          ? JSON.stringify({
              ...prevSnap.summary,
              preservedActionItems: prevSnap.actions.map((a) => ({
                description: a.description,
                owner: a.owner,
                due: a.dueDate,
              })),
            })
          : undefined,
        preferChineseOutput: enableTranslationRef.current,
      });
      
      if (result) {
        console.log('[LLM] Generation successful:', result);
        
        setMeeting(prev => {
          if (!prev) return prev;
          
          const newActions = (result.actionItems || [])
            .filter((item) => item.description?.trim())
            .map((item, index) => ({
              id: `action_${Date.now()}_${index}_${Math.random()}`,
              meetingId: prev.id,
              sourceSegmentId: '',
              description: item.description.trim(),
              owner: item.owner && item.owner !== "" ? item.owner : null,  // ✅ 直接用 LLM 返回的
              dueDate: item.due || null,  // ✅ 直接用 LLM 返回的
              status: 'pending_confirmation' as const,
              confidence: 0.8
            }));
          
          const existingDescriptions = new Set(prev.actions.map(a => a.description));
          const uniqueNewActions = newActions.filter(a => !existingDescriptions.has(a.description));
          const allActions = uniqueNewActions.length > 0 ? uniqueNewActions : prev.actions;
          
          const mergedSummary = {
            summaryText: result.summaryText || prev.summary.summaryText,
            topics: result.topics?.length ? result.topics.slice(0, 6) : prev.summary.topics,
            briefPoints: result.briefPoints?.length ? result.briefPoints.slice(0, 6) : prev.summary.briefPoints,
            decisions: result.decisions?.length ? result.decisions.slice(0, 6) : prev.summary.decisions,
            nextActions: result.nextActions?.length ? result.nextActions.slice(0, 8) : prev.summary.nextActions,
            risks: result.risks?.length ? result.risks.slice(0, 4) : prev.summary.risks,
            updatedAt: new Date().toISOString()
          };
          
          return {
            ...prev,
            summary: mergedSummary,
            actions: allActions,
          };
        });
      }
    } catch (error) {
      console.error('[LLM] Generation failed:', error);
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  const handleVoiceTranscript = async (speakerName: string, text: string) => {
    console.log('[UI] Received voice transcript:', { speakerName, text });
    
    let currentMeeting = meeting;
    if (!currentMeeting?.id) {
      console.log('[UI] Meeting does not exist, creating...');
      try {
        currentMeeting = await createMeeting(meetingTitle || 'New Meeting');
        setMeeting(currentMeeting);
      } catch (e) {
        console.error('[UI] Failed to create meeting:', e);
        setError('Failed to create meeting, please refresh and try again');
        return;
      }
    }
    
    if (!currentMeeting?.id) return;
    
    setInterimText("");
    
    let translatedText = '';
    if (enableTranslation) {
      const hasChinese = /[\u4e00-\u9fa5]/.test(text);
      if (!hasChinese) {
        console.log('[UI] Starting translation:', text.substring(0, 50));
        try {
          const translation = await translateText(text, 'zh');
          translatedText = translation || '';
          console.log('[UI] Translation result:', translatedText);
        } catch (e) {
          console.error('[UI] Translation failed:', e);
        }
      } else {
        translatedText = text;
      }
    }
    
    const newSegment = {
      id: `temp_${Date.now()}_${Math.random()}`,
      meetingId: currentMeeting.id,
      speakerName: speakerName,
      speakerId: 'unknown',
      text: text,
      language: language,
      translatedText: translatedText,
      startMs: 0,
      endMs: 0,
      isFinal: true,
      createdAt: new Date().toISOString()
    };
    
    setMeeting(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        transcript: [...prev.transcript, newSegment]
      };
    });
    
    try {
      const updatedMeeting = await postSegment(currentMeeting.id, speakerName, text, language, translatedText, enableTranslation);
      console.log('[UI] Backend save successful', updatedMeeting);
      setMeeting(updatedMeeting);

      const transcriptTexts = updatedMeeting.transcript.map(seg => `${seg.speakerName}: ${seg.text}`);
      const latestText = updatedMeeting.transcript[updatedMeeting.transcript.length - 1]?.text ?? "";
      const now = Date.now();
      const timeSinceLastCall = now - lastLlmCallTimeRef.current;
      const hasServerSummary = updatedMeeting.summary?.topics?.length || updatedMeeting.summary?.decisions?.length || updatedMeeting.summary?.nextActions?.length || updatedMeeting.summary?.risks?.length;
      const shouldFastRefresh = ACTION_HINT_RE.test(latestText) && timeSinceLastCall >= 6000;

      if (
        transcriptTexts.length > 0 &&
        (!hasServerSummary || timeSinceLastCall >= LLM_INTERVAL_MS || shouldFastRefresh)
      ) {
        lastLlmCallTimeRef.current = now;
        await generateAndUpdateSummary(transcriptTexts);
      }
    } catch (e) {
      console.error('[UI] Save failed:', e);
      setError(e instanceof Error ? e.message : "Voice submission failed");
      setMeeting(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          transcript: prev.transcript.filter(seg => seg.id !== newSegment.id)
        };
      });
    }
  };

  const handleInterimUpdate = (text: string) => {
    setInterimText(text);
  };

  // Calculate meeting stats
  const meetingStats = {
    id: meeting?.id ?? "Not created",
    participantCount: meeting?.participants.length ?? 0,
    transcriptCount: meeting?.transcript.length ?? 0,
    actionCount: meeting?.actions.length ?? 0,
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-cyan-100 p-4 md:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.15),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(6,182,212,0.16),transparent_25%),radial-gradient(circle_at_30%_80%,rgba(16,185,129,0.12),transparent_26%)]" />
      <div className="relative mx-auto grid w-full max-w-7xl gap-4 md:gap-6">
        {/* Top card: Title + meeting status compact */}
        <Card className="border-sky-200/70 bg-white/85 backdrop-blur">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
                <Sparkles className="size-5 text-sky-600" />
                Intelligent Meeting Assistant
              </CardTitle>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="bg-white/50">
                  📋 {meetingStats.id.slice(0, 8)}...
                </Badge>
                <Badge variant="outline" className="bg-white/50">
                  👥 {meetingStats.participantCount}
                </Badge>
                <Badge variant="outline" className="bg-white/50">
                  💬 {meetingStats.transcriptCount}
                </Badge>
                <Badge variant="outline" className="bg-white/50">
                  ✅ {meetingStats.actionCount}
                </Badge>
              </div>
            </div>
            <CardDescription>Real-time transcription, rolling summary, action extraction & sentiment analysis (MVP)</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={meetingTitle} onChange={(e) => setMeetingTitle(e.target.value)} disabled={Boolean(meeting)} />
            <Button 
              onClick={async () => {
                if (meeting) return;
                const created = await createMeeting(meetingTitle);
                setMeeting(created);
              }}
              disabled={Boolean(meeting)}
            >
              Create Meeting
            </Button>
          </CardContent>
        </Card>

        {/* Main content area: left input + right summary/actions */}
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {/* Left: Real-time input + transcript area */}
          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mic className="size-4 text-sky-600" />
                Real-time Input & Transcription
              </CardTitle>
              <CardDescription>Voice or manual input, automatic sentiment detection per sentence</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <VoiceAssistant 
                meetingId={meeting?.id || null} 
                onTranscriptReceived={handleVoiceTranscript}
                onInterimUpdate={handleInterimUpdate}
              />
              
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-background px-2 text-muted-foreground">or manual input</span>
                </div>
              </div>
              
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} placeholder="Speaker" />
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="Language code, e.g. zh/en" />
              </div>
              
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enableTranslation"
                  checked={enableTranslation}
                  onChange={(e) => setEnableTranslation(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <label htmlFor="enableTranslation" className="text-sm text-muted-foreground">
                  Enable auto translation (English to Chinese)
                </label>
              </div>
              
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter a sentence, e.g., I will send the report by Friday."
                className="min-h-28"
              />
              <div className="flex items-center gap-3">
                <Button onClick={handleSubmitSegment} disabled={!mounted || !meeting || isSubmitting || !text.trim()}>
                  Send to real-time pipeline
                </Button>
                {error ? <span className="text-sm text-red-600">{error}</span> : null}
              </div>
            </CardContent>
          </Card>

          {/* Right: Summary + Action Items */}
          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-lg">Real-time Insights</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="summary" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="summary" className="flex items-center gap-1"><Sparkles className="size-4" />Summary</TabsTrigger>
                  <TabsTrigger value="actions" className="flex items-center gap-1"><CheckCircle2 className="size-4" />Actions</TabsTrigger>
                </TabsList>

                <TabsContent value="summary" className="mt-4 grid gap-4">
                  {meeting?.summary.summaryText && (
                    <div className="rounded-lg border p-3 bg-sky-50">
                      <h3 className="mb-2 text-sm font-semibold">Meeting Summary</h3>
                      <p className="text-sm whitespace-pre-wrap">{meeting.summary.summaryText}</p>
                    </div>
                  )}
                  <div className="rounded-lg border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Key Topics</h3>
                    <div className="flex flex-wrap gap-2">
                      {displayTopics.map((topic) => (
                        <Badge key={topic} variant="secondary">{topic}</Badge>
                      ))}
                      {displayTopics.length === 0 && !isGeneratingSummary && (
                        <span className="text-sm text-muted-foreground">No topics yet</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Decisions & Next Steps</h3>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {displayBriefPoints.length > 0 ? (
                        <ol className="m-0 list-none space-y-3">
                          {displayBriefPoints.map((item, idx) => (
                            <li key={`bp-${idx}`} className="flex gap-2">
                              <span className="min-w-[1.75rem] shrink-0 text-right">{idx + 1}.</span>
                              <span className="min-w-0 flex-1 leading-relaxed">{item}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <>
                          {(meeting?.summary.decisions ?? []).map((item, idx) => (
                            <li key={`d-${idx}`}>• {item}</li>
                          ))}
                          {(meeting?.summary.nextActions ?? []).map((item, idx) => (
                            <li key={`n-${idx}`}>• {item}</li>
                          ))}
                          {meeting?.summary.decisions?.length === 0 && meeting?.summary.nextActions?.length === 0 && !isGeneratingSummary && (
                            <li className="text-muted-foreground">No decisions or actions yet</li>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <h3 className="mb-2 text-sm font-semibold">Risks & Challenges</h3>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {displayRisks.map((item, idx) => (
                        <li key={`r-${idx}`}>• {item}</li>
                      ))}
                      {displayRisks.length === 0 && !isGeneratingSummary && (
                        <li className="text-muted-foreground">No risks identified</li>
                      )}
                    </ul>
                  </div>
                  {isGeneratingSummary && (
                    <div className="text-center text-sm text-muted-foreground py-4">
                      Generating summary...
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="actions" className="mt-4">
                  <div className="rounded-lg border p-3">
                    <div className="space-y-3">
                      {(meeting?.actions ?? []).map((a) => (
                        <div key={a.id} className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-sm font-medium">{a.description}</p>
                          <Separator className="my-2" />
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <Badge variant="outline">Owner: {a.owner ?? "TBD"}</Badge>
                            <Badge variant="outline">Due: {a.dueDate ?? "Not set"}</Badge>
                            <Badge variant="outline">Confidence: {a.confidence.toFixed(2)}</Badge>
                          </div>
                        </div>
                      ))}
                      {(meeting?.actions ?? []).length === 0 && !isGeneratingSummary && (
                        <p className="text-sm text-muted-foreground">No action items identified yet.</p>
                      )}
                      {isGeneratingSummary && (
                        <p className="text-sm text-muted-foreground">Generating summary and action items...</p>
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Transcript area - full width card with sentiment labels */}
        <Card className="bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="size-4 text-sky-600" />
              Meeting Transcript
            </CardTitle>
            <CardDescription>Each entry automatically detects sentiment (😊 Positive, ⚠️ Tension, 👎 Disagreement, etc.)</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80 rounded-md border p-3">
              <div className="space-y-3">
                {interimText && (
                  <div className="rounded-lg border bg-sky-50/50 p-3">
                    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="bg-sky-100">Recognizing</Badge>
                      <span>Real-time transcription...</span>
                    </div>
                    <p className="text-sm leading-6 italic text-sky-700">{interimText}</p>
                  </div>
                )}
                {(meeting?.transcript ?? []).slice().reverse().map((seg) => {
                  const sentiment = getSentimentForSegment(seg.id, meeting?.sentiments ?? []);
                  return (
                    <div key={seg.id} className="rounded-lg border bg-muted/40 p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{seg.speakerName}</Badge>
                        <span>{seg.language}</span>
                        <span>{new Date(seg.createdAt).toLocaleTimeString()}</span>
                        {sentiment && (
                          <Badge variant="secondary" className="gap-1">
                            {sentiment.icon} {sentiment.text}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm leading-6">{seg.text}</p>
                      {seg.translatedText && seg.translatedText !== seg.text && (
                        <p className="text-sm leading-6 text-sky-600 mt-1 border-t pt-1">
                          📝 {seg.translatedText}
                        </p>
                      )}
                    </div>
                  );
                })}
                {meeting?.transcript.length === 0 && !interimText && (
                  <p className="text-center text-sm text-muted-foreground py-8">
                    No content yet. Click the microphone to start voice recognition or enter text manually.
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}