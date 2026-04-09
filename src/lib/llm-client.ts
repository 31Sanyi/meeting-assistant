import OpenAI from "openai";

export interface LlmSummaryInput {
  transcriptWindow: string[];
  previousSummary?: string;
}

export interface LlmSummaryOutput {
  summaryText: string;
  topics: string[];
  decisions: string[];
  nextActions: string[];
  risks: string[];
  actionItems: Array<{
    owner: string;
    due: string | null;
    description: string;
  }>;
}

function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    return null;
  }

  return new OpenAI({ apiKey, baseURL });
}

function tryParseJsonObject(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    // Some models may wrap JSON in prose or code fences. Try to salvage.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const sliced = text.slice(start, end + 1);
      try {
        return JSON.parse(sliced);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeSummaryOutput(value: unknown): LlmSummaryOutput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const summaryText = typeof v.summaryText === "string" ? v.summaryText : null;
  const topics = Array.isArray(v.topics) ? v.topics.filter((x): x is string => typeof x === "string") : null;
  const decisions = Array.isArray(v.decisions) ? v.decisions.filter((x): x is string => typeof x === "string") : null;
  const nextActions = Array.isArray(v.nextActions) ? v.nextActions.filter((x): x is string => typeof x === "string") : null;
  const risks = Array.isArray(v.risks) ? v.risks.filter((x): x is string => typeof x === "string") : null;
  const actionItemsRaw = Array.isArray(v.actionItems) ? v.actionItems : null;
  const actionItems = actionItemsRaw
    ? actionItemsRaw
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const it = item as Record<string, unknown>;
          const owner = typeof it.owner === "string" ? it.owner.trim() : "";
          const description = typeof it.description === "string" ? it.description.trim() : "";
          const due = it.due === null || typeof it.due === "string" ? it.due : null;
          if (!owner || !description) return null;
          return { owner, due, description };
        })
        .filter((x): x is { owner: string; due: string | null; description: string } => Boolean(x))
    : null;

  if (!summaryText || !topics || !decisions || !nextActions || !risks || !actionItems) return null;
  return { summaryText, topics, decisions, nextActions, risks, actionItems };
}

export async function generateSummaryWithLlm(input: LlmSummaryInput): Promise<LlmSummaryOutput | null> {
  const client = getClient();
  if (!client) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const system = [
    "You are a meeting assistant for a software team's meeting.",
    "Return ONLY strict JSON (no markdown, no prose).",
    'Schema: {"summaryText": string, "topics": string[], "decisions": string[], "nextActions": string[], "risks": string[], "actionItems": {owner: string, due: string|null, description: string}[]}.',
    "Write in Chinese.",
    "summaryText should be ONE concise paragraph (1-2 sentences).",
    "actionItems should be concrete and executable; keep due as natural language like '今天下午'/'本周四下班前' or null.",
    "For owner, use a person's name if mentioned; otherwise infer from speaker when reasonable.",
  ].join("\n");

  const user = [
    `Previous summary: ${input.previousSummary ?? "none"}`,
    "Transcript window (most recent lines):",
    ...input.transcriptWindow.map((line, i) => `${i + 1}. ${line}`),
  ].join("\n");

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  // Prefer the newer Responses API; fall back to Chat Completions for providers
  // that don't implement /v1/responses (many OpenAI-compatible gateways).
  try {
    const response = await client.responses.create({
      model,
      input: messages,
      temperature: 0.1,
    });

    const text = response.output_text?.trim();
    if (!text) return null;
    return normalizeSummaryOutput(tryParseJsonObject(text));
  } catch (err) {
    const e = err as { status?: number };
    if (e?.status !== 404) {
      return null;
    }

    try {
      const chat = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.1,
      });

      const text = chat.choices?.[0]?.message?.content?.trim();
      if (!text) return null;
      return normalizeSummaryOutput(tryParseJsonObject(text));
    } catch {
      return null;
    }
  }
}
