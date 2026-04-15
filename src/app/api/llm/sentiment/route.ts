import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { text } = await request.json();

    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey || !baseURL) {
      return NextResponse.json(
        { error: 'LLM 服务未配置' },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey, baseURL });

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: "system",
          content: `你是一个情绪分析专家。分析用户输入的文本，返回情绪标签。只输出 JSON，不要有其他内容。

情绪标签必须是以下之一：
- "positive": 积极、赞同、满意、兴奋
- "negative": 消极、反对、不满、失望
- "neutral": 中性、客观陈述、无情绪
- "tension": 紧张、焦虑、压力大
- "hesitation": 犹豫、不确定、怀疑
- "agreement": 同意、支持、认可
- "disagreement": 不同意、反对、质疑

输出格式：{"sentiment": "标签", "confidence": 0.0-1.0}`
        },
        {
          role: "user",
          content: text
        }
      ],
      temperature: 0.1,
      max_tokens: 100,
    });

    const result = response.choices[0]?.message?.content?.trim();
    let parsed;
    try {
      parsed = JSON.parse(result || '{}');
    } catch {
      parsed = { sentiment: 'neutral', confidence: 0.5 };
    }

    console.log('[情绪分析] 输入:', text.substring(0, 100), '输出:', parsed);

    return NextResponse.json({
      sentiment: parsed.sentiment || 'neutral',
      confidence: parsed.confidence || 0.5
    });
  } catch (error) {
    console.error('[情绪分析 API] 错误:', error);
    return NextResponse.json(
      { sentiment: 'neutral', confidence: 0.5 },
      { status: 200 }
    );
  }
}