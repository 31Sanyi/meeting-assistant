// src/lib/llm-client.ts
export interface LlmSummaryInput {
  transcriptWindow: string[];
  previousSummary?: string;
  /** 开启「英译中」时为 true：摘要与行动项强制中文；否则跟随转写语言 */
  preferChineseOutput?: boolean;  // ✅ 新增
}

export interface LlmSummaryOutput {
  topics: string[];
  briefPoints?: string[];  // ✅ 新增
  decisions: string[];
  nextActions: string[];
  risks: string[];
  summaryText?: string;
  actionItems?: Array<{
    owner: string;
    due: string | null;
    description: string;
  }>;
}

// 获取完整的 API URL
function getApiUrl(path: string): string {
  // 浏览器环境：使用相对路径
  if (typeof window !== 'undefined') {
    return path;
  }
  
  // 服务端环境：需要完整 URL
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

/**
 * 调用LLM生成会议摘要（通过后端 API）
 */
export async function generateSummaryWithLlm(input: LlmSummaryInput): Promise<LlmSummaryOutput | null> {
  try {
    const url = getApiUrl('/api/llm/summary');
    console.log('[LLM] 请求 URL:', url);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcriptWindow: input.transcriptWindow,
        previousSummary: input.previousSummary,
        preferChineseOutput: input.preferChineseOutput  // ✅ 新增
      })
    });
    
    if (!response.ok) {
      console.error('[LLM] API 响应错误:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    return {
      topics: data.topics || [],
      briefPoints: data.briefPoints || [],  // ✅ 新增
      decisions: data.decisions || [],
      nextActions: data.nextActions || [],
      risks: data.risks || [],
      summaryText: data.summaryText,
      actionItems: data.actionItems || []
    };
  } catch (error) {
    console.error('[LLM] 调用失败:', error);
    return null;
  }
}

/**
 * 翻译文本到中文
 */
export async function translateText(text: string): Promise<string | null> {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const chineseRegex = /[\u4e00-\u9fa5]/;
  if (chineseRegex.test(text)) {
    return text;
  }

  try {
    const url = getApiUrl('/api/llm/translate');
    const response = await fetch(url, {
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