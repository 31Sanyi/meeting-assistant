import { NextResponse } from 'next/server';
import * as crypto from 'crypto';

function formatUtcPlus0800(date: Date): string {
  const utc8 = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = utc8.getUTCFullYear();
  const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc8.getUTCDate()).padStart(2, '0');
  const hh = String(utc8.getUTCHours()).padStart(2, '0');
  const mi = String(utc8.getUTCMinutes()).padStart(2, '0');
  const ss = String(utc8.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+0800`;
}

function signIflyParams(params: Record<string, string>, accessKeySecret: string): string {
  const baseString = Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  return crypto
    .createHmac('sha1', accessKeySecret)
    .update(baseString)
    .digest('base64');
}

export async function POST() {
  const appId = process.env.IFLY_APP_ID;
  const accessKeyId = process.env.IFLY_ACCESS_KEY_ID;
  const accessKeySecret = process.env.IFLY_ACCESS_KEY_SECRET;
  const endpoint = process.env.IFLY_RTASR_ENDPOINT || 'wss://office-api-ast-dx.iflyaisol.com/ast/communicate/v1';

  if (!appId || !accessKeyId || !accessKeySecret) {
    return NextResponse.json(
      { error: '讯飞实时转写未配置，请检查 IFLY_APP_ID / IFLY_ACCESS_KEY_ID / IFLY_ACCESS_KEY_SECRET' },
      { status: 503 }
    );
  }

  try {
    const utc = formatUtcPlus0800(new Date());
    const sessionId = crypto.randomUUID();

    // 不启用领域参数 pd；多语识别使用 autodialect；角色分离启用盲分 role_type=2
    const params: Record<string, string> = {
      accessKeyId,
      appId,
      uuid: sessionId,
      utc,
      audio_encode: 'pcm_s16le',
      lang: 'autodialect',
      samplerate: '16000',
      role_type: '2',
    };

    const signature = signIflyParams(params, accessKeySecret);
    const query = new URLSearchParams({ ...params, signature });
    const wsUrl = `${endpoint}?${query.toString()}`;

    console.log('[讯飞] 已生成实时握手 URL', {
      endpoint,
      lang: params.lang,
      roleType: params.role_type,
      sessionId,
    });

    return NextResponse.json({
      provider: 'ifly',
      wsUrl,
      sessionId,
    });
  } catch (error: any) {
    console.error('[讯飞] 创建实时连接参数失败:', error);
    return NextResponse.json(
      {
        error: '创建讯飞实时连接失败',
        details: error.message || '未知错误',
      },
      { status: 500 }
    );
  }
}