import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { transcriptWindow, previousSummary } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey || !baseURL) {
      console.error('[LLM API] 配置缺失');
      return NextResponse.json(
        { error: 'LLM 服务未配置，请检查环境变量' },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey, baseURL });

    // 格式化转录内容
    const formattedTranscript = transcriptWindow
      .map((line: string, i: number) => `${i + 1}. ${line}`)
      .join('\n');

    // 检测语言
    const hasChinese = /[\u4e00-\u9fa5]/.test(formattedTranscript);
    const isEnglish = /[a-zA-Z]/.test(formattedTranscript) && formattedTranscript.length > 50;
    
    console.log('[LLM API] 检测到语言:', hasChinese ? '中文' : isEnglish ? '英文' : '未知');

    // 格式化历史摘要
    let previousSummaryText = '无';
    if (previousSummary && previousSummary !== 'none') {
      try {
        const parsed = JSON.parse(previousSummary);
        if (parsed.topics?.length || parsed.decisions?.length) {
          previousSummaryText = `- 主题: ${parsed.topics?.join(', ') || '无'}\n- 决策: ${parsed.decisions?.join(', ') || '无'}\n- 行动: ${parsed.nextActions?.join(', ') || '无'}\n- 风险: ${parsed.risks?.join(', ') || '无'}`;
        }
      } catch {
        previousSummaryText = previousSummary;
      }
    }

    // 根据语言选择不同的 Prompt
    let prompt: string;
    
    if (hasChinese) {
      // 中文会议 Prompt
      prompt = `你是一个专业的会议摘要助手。你的任务是根据会议对话记录，提取关键信息并以严格JSON格式返回。

## 输出格式要求
{
  "topics": ["主题1", "主题2", ...],
  "decisions": ["决策1", "决策2", ...],
  "nextActions": ["行动1", "行动2", ...],
  "risks": ["风险1", "风险2", ...]
}

## 数量限制
- topics: 最多5个核心主题
- decisions: 最多3个团队达成的一致结论
- nextActions: 最多4个明确的后续步骤
- risks: 最多3个提到的障碍或风险

## 提取规则
1. **主题(topics)**：提取对话中反复出现或占据主要篇幅的话题，使用2-6个字的短语
2. **决策(decisions)**：必须是团队达成的共识，包含"决定"、"同意"、"确认"、"定下来"等关键词
3. **行动(nextActions)**：必须有明确的责任人或时间节点，包含"会"、"将"、"需要"、"周五前"等关键词
4. **风险(risks)**：包括时间压力、资源不足、技术难点、依赖阻塞、外部因素等
5. **空数组处理**：如果某个类别完全没有相关内容，返回空数组 []
6. **简洁性原则**：每个条目控制在15个字以内，只提取明确陈述的内容
7. **不推断原则**：不要基于上下文推断未明确表达的内容

## 之前的摘要（供参考，避免重复）
${previousSummaryText}

## 会议对话记录
${formattedTranscript}

## 重要提醒
- 只输出纯JSON，不要有任何解释性文字
- JSON必须是有效的、可解析的格式
- 使用双引号，不要使用单引号

请直接输出JSON：`;
    } else {
      // 英文/通用内容 Prompt
      prompt = `You are a text analysis assistant. Analyze the following conversation/text and extract key information in JSON format.

## Output Format
{
  "topics": ["topic1", "topic2", ...],
  "decisions": ["decision1", "decision2", ...],
  "nextActions": ["action1", "action2", ...],
  "risks": ["risk1", "risk2", ...]
}

## Rules
- topics: Extract main themes or recurring subjects (max 5)
- decisions: Extract any conclusions or agreements reached (max 3)
- nextActions: Extract any planned actions or next steps (max 4)
- risks: Extract any obstacles, challenges, or concerns mentioned (max 3)
- Return empty array [] if a category has no content
- Keep each item concise (under 20 words)

## Previous Summary (for reference)
${previousSummaryText}

## Content to Analyze
${formattedTranscript}

## Important
- Output ONLY valid JSON, no explanation
- Use double quotes, not single quotes

Output JSON directly:`;
    }

    console.log('[LLM API] 开始调用 LLM...');

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: hasChinese 
            ? '你是一个专业的会议摘要助手。你只输出JSON格式的会议摘要，不输出任何其他内容。'
            : 'You are a text analysis assistant. Output only valid JSON, no other text.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,  // 稍微提高温度，让英文内容有更好的理解
      max_tokens: 800,

    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      console.error('[LLM API] 返回内容为空');
      // 返回空结果而不是错误
      return NextResponse.json({ 
        success: true, 
        topics: [], 
        decisions: [], 
        nextActions: [], 
        risks: [] 
      });
    }

    console.log('[LLM API] 原始响应:', text.substring(0, 300));

    // 解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (parseError) {
      console.warn('[LLM API] JSON 解析失败，尝试提取嵌入JSON...');
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (nestedError) {
          console.error('[LLM API] 嵌套JSON解析失败，返回空结果');
          return NextResponse.json({ 
            success: true, 
            topics: [], 
            decisions: [], 
            nextActions: [], 
            risks: [] 
          });
        }
      } else {
        console.error('[LLM API] JSON 解析失败，返回空结果');
        return NextResponse.json({ 
          success: true, 
          topics: [], 
          decisions: [], 
          nextActions: [], 
          risks: [] 
        });
      }
    }

    const result = {
      topics: (parsed.topics || []).slice(0, 5).filter((t: string) => t && t.trim()),
      decisions: (parsed.decisions || []).slice(0, 3).filter((d: string) => d && d.trim()),
      nextActions: (parsed.nextActions || []).slice(0, 4).filter((a: string) => a && a.trim()),
      risks: (parsed.risks || []).slice(0, 3).filter((r: string) => r && r.trim()),
    };

    console.log(`[LLM API] 生成成功: 主题=${result.topics.length}, 决策=${result.decisions.length}, 行动=${result.nextActions.length}, 风险=${result.risks.length}`);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[LLM API] 错误:', error);
    // 返回空结果而不是错误，避免前端报错
    return NextResponse.json({ 
      success: true, 
      topics: [], 
      decisions: [], 
      nextActions: [], 
      risks: [] 
    });
  }
}