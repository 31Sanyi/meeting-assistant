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
import { Meeting } from "@/types/meeting";
import { Activity, CheckCircle2, Languages, Mic, Sparkles, Users } from "lucide-react";

async function createMeeting(title: string) {
  const res = await fetch("/api/meetings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error("创建会议失败");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

async function postSegment(meetingId: string, speakerName: string, text: string, language: string) {
  const res = await fetch(`/api/meetings/${meetingId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speakerName, text, language, isFinal: true }),
  });

  if (!res.ok) {
    throw new Error("提交发言失败");
  }
}

async function fetchSnapshot(meetingId: string) {
  const res = await fetch(`/api/meetings/${meetingId}/snapshot`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("获取会议快照失败");
  }

  const data = (await res.json()) as { meeting: Meeting };
  return data.meeting;
}

export function MeetingDashboard() {
  const initialTitleRef = useRef("产品周会 - 智能助手演示");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [meetingTitle, setMeetingTitle] = useState(initialTitleRef.current);
  const [speakerName, setSpeakerName] = useState("Alice");
  const [language, setLanguage] = useState("zh");
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          setError(e instanceof Error ? e.message : "初始化失败");
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!meeting?.id) return;

    const timer = setInterval(async () => {
      try {
        const latest = await fetchSnapshot(meeting.id);
        setMeeting(latest);
      } catch {
        // Polling should not interrupt user interaction.
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [meeting?.id]);

  const sentimentOverview = useMemo(() => {
    const sentiments = meeting?.sentiments ?? [];
    if (!sentiments.length) {
      return "暂无显著情绪波动";
    }

    const latest = sentiments[sentiments.length - 1];
    return `最近信号：${latest.label}（强度 ${latest.intensity.toFixed(2)}）`;
  }, [meeting?.sentiments]);

  async function handleSubmitSegment() {
    if (!meeting?.id || !text.trim()) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await postSegment(meeting.id, speakerName, text.trim(), language);
      const latest = await fetchSnapshot(meeting.id);
      setMeeting(latest);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-100 via-sky-50 to-cyan-100 p-4 md:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.15),transparent_28%),radial-gradient(circle_at_80%_10%,rgba(6,182,212,0.16),transparent_25%),radial-gradient(circle_at_30%_80%,rgba(16,185,129,0.12),transparent_26%)]" />
      <div className="relative mx-auto grid w-full max-w-7xl gap-4 md:gap-6">
        <Card className="border-sky-200/70 bg-white/85 backdrop-blur">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-xl md:text-2xl">
              <Sparkles className="size-5 text-sky-600" />
              智能会议助手
            </CardTitle>
            <CardDescription>实时转录、滚动摘要、行动项提取与情绪分析（MVP）</CardDescription>
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
              创建会议
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Mic className="size-4 text-sky-600" />
                实时输入模拟
              </CardTitle>
              <CardDescription>后续可替换为阿里云听悟 WebSocket 回调</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} placeholder="发言人" />
                <Input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="语言代码，例如 zh/en" />
              </div>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入一句发言，例如：我将在周五前发送报告。"
                className="min-h-28"
              />
              <div className="flex items-center gap-3">
                <Button onClick={handleSubmitSegment} disabled={!meeting || isSubmitting || !text.trim()}>
                  发送到实时管道
                </Button>
                {error ? <span className="text-sm text-red-600">{error}</span> : null}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Activity className="size-4 text-sky-600" />
                会议状态
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">Meeting ID</span>
                <Badge variant="secondary">{meeting?.id ?? "未创建"}</Badge>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">参与者</span>
                <span className="font-medium">{meeting?.participants.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">转录段数</span>
                <span className="font-medium">{meeting?.transcript.length ?? 0}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-muted-foreground">行动项</span>
                <span className="font-medium">{meeting?.actions.length ?? 0}</span>
              </div>
              <div className="rounded-lg border p-3">
                <p className="mb-1 text-muted-foreground">情绪概览</p>
                <p className="font-medium">{sentimentOverview}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-white/90 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">实时洞察</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="transcript" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="transcript" className="flex items-center gap-1"><Users className="size-4" />转录</TabsTrigger>
                <TabsTrigger value="summary" className="flex items-center gap-1"><Sparkles className="size-4" />摘要</TabsTrigger>
                <TabsTrigger value="actions" className="flex items-center gap-1"><CheckCircle2 className="size-4" />行动项</TabsTrigger>
                <TabsTrigger value="translation" className="flex items-center gap-1"><Languages className="size-4" />翻译视图</TabsTrigger>
              </TabsList>

              <TabsContent value="transcript" className="mt-4">
                <ScrollArea className="h-72 rounded-md border p-3">
                  <div className="space-y-3">
                    {(meeting?.transcript ?? []).slice().reverse().map((seg) => (
                      <div key={seg.id} className="rounded-lg border bg-muted/40 p-3">
                        <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{seg.speakerName}</Badge>
                          <span>{seg.language}</span>
                          <span>{new Date(seg.createdAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-sm leading-6">{seg.text}</p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="summary" className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border p-3 md:col-span-2">
                  <h3 className="mb-2 text-sm font-semibold">摘要</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {meeting?.summary.summaryText?.trim()
                      ? meeting.summary.summaryText
                      : "暂无摘要（等待模型生成或转录内容不足）。"}
                  </p>
                </div>
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-semibold">关键主题</h3>
                  <div className="flex flex-wrap gap-2">
                    {(meeting?.summary.topics ?? []).map((topic) => (
                      <Badge key={topic} variant="secondary">{topic}</Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border p-3">
                  <h3 className="mb-2 text-sm font-semibold">决策与后续</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {(meeting?.summary.decisions ?? []).map((item, idx) => (
                      <li key={`d-${idx}`}>• {item}</li>
                    ))}
                    {(meeting?.summary.nextActions ?? []).map((item, idx) => (
                      <li key={`n-${idx}`}>• {item}</li>
                    ))}
                  </ul>
                </div>
              </TabsContent>

              <TabsContent value="actions" className="mt-4">
                <div className="rounded-lg border p-3">
                  <div className="space-y-3">
                    {(meeting?.actions ?? []).map((a) => (
                      <div key={a.id} className="rounded-lg border bg-muted/30 p-3">
                        <p className="text-sm font-medium">
                          {(a.owner ? `${a.owner}: ` : "") + a.description}
                        </p>
                        <Separator className="my-2" />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">Owner: {a.owner ?? "待确认"}</Badge>
                          <Badge variant="outline">Due: {a.dueDate ?? "未识别"}</Badge>
                          <Badge variant="outline">Confidence: {a.confidence.toFixed(2)}</Badge>
                        </div>
                      </div>
                    ))}
                    {meeting?.actions.length ? null : <p className="text-sm text-muted-foreground">暂未识别到行动项。</p>}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="translation" className="mt-4">
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-sm text-muted-foreground">MVP 阶段先展示原文片段，后续接入实时翻译 Worker。</p>
                  <div className="space-y-2 text-sm">
                    {(meeting?.transcript ?? []).slice(-6).map((seg) => (
                      <div key={`t-${seg.id}`} className="rounded-md bg-muted/30 px-3 py-2">
                        <span className="font-medium">{seg.speakerName}：</span>
                        <span>{seg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
