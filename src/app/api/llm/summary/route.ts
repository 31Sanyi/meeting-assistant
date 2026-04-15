import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

export async function POST(request: NextRequest) {
  try {
    const { transcriptWindow, previousSummary, preferChineseOutput = false } = await request.json();

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
    
    console.log('[LLM API] 检测到语言:', hasChinese ? '中文' : isEnglish ? '英文' : '未知', 'preferChineseOutput:', preferChineseOutput);

    // 格式化历史摘要（增加 preservedActionItems 支持）
    let previousSummaryText = '无';
    if (previousSummary && previousSummary !== 'none') {
      try {
        const parsed = JSON.parse(previousSummary);
        const hasPrevContent =
          parsed.topics?.length ||
          parsed.decisions?.length ||
          parsed.briefPoints?.length ||
          (typeof parsed.summaryText === 'string' && parsed.summaryText.trim()) ||
          (Array.isArray(parsed.preservedActionItems) && parsed.preservedActionItems.length > 0);
        if (hasPrevContent) {
          const preservedLines =
            Array.isArray(parsed.preservedActionItems) && parsed.preservedActionItems.length
              ? `\n- **之前已识别的行动项**（除非已取消或完成，否则需继续保留）：\n${parsed.preservedActionItems
                  .map(
                    (x: { description?: string; owner?: string | null; due?: string | null }, i: number) =>
                      `  ${i + 1}. ${(x.description || '').trim()}${x.due ? ` [截止：${x.due}]` : ''}${x.owner ? ` [负责人：${x.owner}]` : ''}`,
                  )
                  .join('\n')}`
              : '';
          previousSummaryText = `- 一段话摘要: ${parsed.summaryText || '无'}\n- 小结要点: ${(parsed.briefPoints || []).join(' | ') || '无'}\n- 主题: ${parsed.topics?.join(', ') || '无'}\n- 决策: ${parsed.decisions?.join(', ') || '无'}\n- 行动(nextActions短语): ${parsed.nextActions?.join(', ') || '无'}\n- 风险: ${parsed.risks?.join(', ') || '无'}${preservedLines}`;
        }
      } catch {
        previousSummaryText = previousSummary;
      }
    }

    const zhSuffix = `

## 之前的摘要（供参考，避免重复）
${previousSummaryText}

## 会议对话记录
${formattedTranscript}

## 重要提醒
- 只输出纯JSON，不要有任何解释性文字
- JSON必须是有效的、可解析的格式
- 使用双引号，不要使用单引号

请直接输出JSON：`;

    const promptZhBody = `## 输出格式要求
{
  "summaryText": "多句简洁摘要，可含若干短段，总字数约200-800字",
  "topics": ["主题1", "主题2", ...],
  "briefPoints": ["直接写内容，不要写序号前缀；用一两句话概括当前讨论焦点或共识。", "……"],
  "decisions": ["决策1", "决策2", ...],
  "nextActions": ["行动1", "行动2", ...],
  "risks": ["风险1", "风险2", ...],
  "actionItems": [
    {"owner": "张三", "due": "周五前", "description": "完成项目报告"},
    {"owner": "李四", "due": "明天", "description": "审核代码"}
  ]
}

## 数量限制
- summaryText: 2-6句为宜，总字数约200-800字，分句清晰；无新信息时不要删光旧摘要，应在兼容前提下补充或在新讨论明显推翻旧结论时再重写
- topics: 最多8个核心主题；**与已有主题或彼此近义/同簇的须合并**（如沟通障碍/沟通失败、沟通与冲突等只保留一条更具体的表述）
- briefPoints: **2-6条**「小结」（**最多6条**），每条**一句为宜**；按会议脉络写清「讨论什么、共识/分歧、走向」；**不要**写成待办清单体，**禁止**与 actionItems 逐条重复；**禁止**在字符串开头写「第一点」「1.」「Point 1」等序号（界面会自动编号）；**须对照「之前的摘要」与已有小结，近义条目合并为一条，勿重复堆砌**
- decisions: 最多6条
- nextActions: 最多8条（可与 actionItems 互补；重复可返回 []）
- risks: 最多4个；**近义风险合并为一条**
- actionItems: 最多6个

## 提取规则
1. **摘要(summaryText)**：简洁但信息完整；可参考「之前的摘要」延续表述，有新进展则补充；对话出现重大转折时可重写整段
2. **主题(topics)**：核心话题短语；**勿输出大小写或拼写变体重复的同一主题**；**勿并列输出近义主题**
3. **小结(briefPoints)**：2-6条串起会议主线（**勿超过6条**）；**无重要新进展时可少写或沿用「之前的摘要」中的要点，勿每次刷新都加长列表**
4. **决策(decisions)**：共识短句（可选）
5. **行动(nextActions)**：后续步骤短语（可选）
6. **风险(risks)**：障碍或担忧；**勿同义重复**；**勿写序号前缀**；与已有风险近义则合并为一条
7. **行动项(actionItems)**：仅保留"未完成、可执行、可指派"的待办。**description** 一句完整概括。**owner**：有人名则填（可保留拼写），否则 ""。**due**：截止时间短语；未提则 null。**必须同时从 summaryText、briefPoints、nextActions 与对话中抽取可执行承诺**（例如摘要写「周五前上传模版」则须有一条对应 actionItems）；**勿只依据最后几条发言而漏掉前文待办**；**须合并「界面已保留的行动项」**，无正当理由不得省略。**严禁**输出"会议讨论了…/项目进展…/已完成…/已提交…"等状态陈述
8. **空数组处理**：若本轮对话未涉及某类新内容，该字段可返回 []（**actionItems 若仍有未完成的「已保留行动项」或摘要中的承诺，则不得为空**）
9. **简洁性原则**：列表条目尽量短，摘要可适当展开
10. **不推断原则**：列表勿凭空臆测
11. **行动项与摘要对齐**：summaryText/briefPoints 中出现的具体待办必须与 actionItems 一致，避免摘要很全而 actionItems 变空
12. **反例过滤**：以下类型绝对不要放到 actionItems："会议讨论了项目进展与后续任务安排"、"某同学已于晚上十点多将文件发至群内"、任何已完成事实`;

    let prompt: string;
    let systemContent: string;

    if (preferChineseOutput) {
      const intro = `你是一个专业的会议摘要助手。用户已**开启「英译中」**：输入可能是中文或英文，**除 actionItems.owner 可保留原文人名拼写外，JSON 中所有其它字符串（summaryText、topics、briefPoints、decisions、nextActions、risks、actionItems.description、due的时间说明）一律输出自然通顺的中文**；原文为英文须翻译；时间用中文习惯。`;
      prompt = `${intro}\n\n${promptZhBody}\n${zhSuffix}`;
      systemContent = '你是专业会议摘要助手。只输出合法 JSON；用户已开启翻译，JSON 内展示内容必须全部为中文（英文须译）。';
    } else if (hasChinese) {
      const intro = `你是一个专业的会议摘要助手。根据以下会议对话提取关键信息，以严格 JSON 返回。**未开启翻译开关：对话主要为中文时，请用中文撰写所有字段。**`;
      prompt = `${intro}\n\n${promptZhBody}\n${zhSuffix}`;
      systemContent = '你是专业会议摘要助手。只输出合法 JSON，不要其它说明文字。';
    } else {
      prompt = `You are a meeting summary assistant. **Translation to Chinese is OFF: use the same language as the conversation** (English conversation → write summaryText, topics, briefPoints, decisions, nextActions, risks, actionItems.description, and due phrases in English). Extract key information as strict JSON.

## Output Format
{
  "summaryText": "Several concise sentences or short paragraphs",
  "topics": ["topic1", "topic2", ...],
  "briefPoints": ["One or two sentences without ordinal prefix.", "..."],
  "decisions": ["decision1", ...],
  "nextActions": ["action1", ...],
  "risks": ["risk1", ...],
  "actionItems": [
    {"owner": "John", "due": "by Friday", "description": "Finish the report"},
    {"owner": "", "due": null, "description": "Review the code"}
  ]
}

## Limits
- summaryText: ~150-500 words if meeting is long; integrate prior summary when compatible
- topics: max 8; merge near-duplicates; briefPoints: 2-6 short bullets, max 6 (not to-do duplicates of actionItems); **no** leading "First," / "1." / "Point 1" (UI numbers items); consolidate with prior summary when similar; risks max 4 merged
- decisions: max 6; nextActions: max 8; risks: max 4 (merge similar); actionItems: max 6

## Rules
1. Match meeting language for all strings (English here).
2. actionItems: include ONLY unfinished, actionable tasks (not status updates). **description must be a single concise clause (≤20 words)**; owner only if stated, else ""; due as in transcript (e.g. "by Friday", "Sept 14") or null — **infer due from description text whenever possible, do not write null if there is a time hint**. **Extract any concrete commitment or deadline even if it lacks explicit "need to/should" verbs** (e.g. "Demo ready by Friday" or "Report due this Thursday" are valid). **Also mine summaryText, briefPoints, and nextActions for concrete todos**; **keep preserved action items from the previous block unless the meeting clearly cancels or completes them**; do not return an empty actionItems if commitments remain there or in the summary.
3. Return [] for empty categories when truly nothing applies (**except actionItems** per rule 2). Never include lines like "the meeting discussed progress" or "X has completed and sent files".
4. Output ONLY valid JSON, double quotes

## Previous Summary (reference)
${previousSummaryText}

## Conversation
${formattedTranscript}

Output JSON directly:`;
      systemContent = 'You are a meeting summary assistant. Output only valid JSON. Match the conversation language (English). No extra text.';
    }

    console.log('[LLM API] 开始调用 LLM...');

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'system',
          content: systemContent,
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 4096,
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) {
      console.error('[LLM API] 返回内容为空');
      return NextResponse.json({ 
        success: true, 
        summaryText: '',
        topics: [], 
        briefPoints: [],
        decisions: [], 
        nextActions: [], 
        risks: [],
        actionItems: []
      });
    }

    console.log('[LLM API] 原始响应:', text.substring(0, 500));

    // 剥离 markdown code fence 包装
    let jsonText = text;
    const fenceMatch = jsonText.match(/^```(?:json|JSON)?\s*\n([\s\S]*?)\n\s*```\s*$/);
    if (fenceMatch) {
      jsonText = fenceMatch[1].trim();
    }

    // 解析 JSON
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (parseError) {
      console.warn('[LLM API] JSON 解析失败，尝试提取嵌入JSON...');
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (nestedError) {
          console.error('[LLM API] 嵌套JSON解析失败，返回空结果');
          return NextResponse.json({ 
            success: true, 
            summaryText: '',
            topics: [], 
            briefPoints: [],
            decisions: [], 
            nextActions: [], 
            risks: [],
            actionItems: []
          });
        }
      } else {
        console.error('[LLM API] JSON 解析失败，返回空结果');
        return NextResponse.json({ 
          success: true, 
          summaryText: '',
          topics: [], 
          briefPoints: [],
          decisions: [], 
          nextActions: [], 
          risks: [],
          actionItems: []
        });
      }
    }

    // 提取并验证各字段
    const result = {
      summaryText: typeof parsed.summaryText === 'string' ? parsed.summaryText.slice(0, 6000) : '',
      topics: (parsed.topics || []).slice(0, 8).filter((t: string) => t && t.trim()),
      briefPoints: (parsed.briefPoints || []).slice(0, 6).filter((b: string) => b && b.trim()),
      decisions: (parsed.decisions || []).slice(0, 6).filter((d: string) => d && d.trim()),
      nextActions: (parsed.nextActions || []).slice(0, 8).filter((a: string) => a && a.trim()),
      risks: (parsed.risks || []).slice(0, 4).filter((r: string) => r && r.trim()),
      actionItems: (parsed.actionItems || [])
        .slice(0, 6)
        .filter((item: any) => item && item.description && item.description.trim())
        .map((item: any) => ({
          owner: typeof item.owner === 'string' ? item.owner.trim() : '',
          due: item.due === null || typeof item.due === 'string' ? item.due : null,
          description: item.description.trim()
        }))
    };

    console.log(`[LLM API] 生成成功: 摘要=${result.summaryText ? '有' : '无'}, 小结=${result.briefPoints.length}, 主题=${result.topics.length}, 决策=${result.decisions.length}, 行动=${result.nextActions.length}, 风险=${result.risks.length}, 行动项=${result.actionItems.length}`);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('[LLM API] 错误:', error);
    return NextResponse.json({ 
      success: true, 
      summaryText: '',
      topics: [], 
      briefPoints: [],
      decisions: [], 
      nextActions: [], 
      risks: [],
      actionItems: []
    });
  }
}