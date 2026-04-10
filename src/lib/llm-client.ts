export interface LlmSummaryInput {
  transcriptWindow: string[];
  previousSummary?: string;
}

export interface LlmSummaryOutput {
  topics: string[];
  decisions: string[];
  nextActions: string[];
  risks: string[];
}

/**
 * 调用LLM生成会议摘要（通过后端 API）
 */
export async function generateSummaryWithLlm(input: LlmSummaryInput): Promise<LlmSummaryOutput | null> {
  try {
    const response = await fetch('/api/llm/summary', {
      method: 'POST',  // 🔥 确保是 POST
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptWindow: input.transcriptWindow,
        previousSummary: input.previousSummary
      })
    });
    
    if (!response.ok) {
      console.error('[LLM] API 响应错误:', response.status);
      return null;
    }
    
    const data = await response.json();
    return {
      topics: data.topics || [],
      decisions: data.decisions || [],
      nextActions: data.nextActions || [],
      risks: data.risks || []
    };
  } catch (error) {
    console.error('[LLM] 调用失败:', error);
    return null;
  }
}

/**
 * 翻译文本到中文（双语对照格式）
 */
export async function translateText(text: string): Promise<string | null> {
  if (!text || text.trim().length === 0) {
    return null;
  }

  // 检测是否已经是中文
  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (chineseRegex.test(text)) {
    return text;
  }

  try {
    const response = await fetch('/api/llm/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[翻译] API 错误:', data.error);
      return null;
    }

    return data.translation || null;
  } catch (error) {
    console.error('[翻译] 请求失败:', error);
    return null;
  }
}