import { RealtimeResult } from '@/types/tingwu';

export type RealtimeCallback = (result: RealtimeResult) => void;

export class TingwuRealtimeClient {
  private ws: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isRecordingFlag = false;
  private onResult: RealtimeCallback;
  private sessionId: string | null = null;
  private lastSpeakerId: string = 'speaker_1';
  private pcmBuffer: Uint8Array = new Uint8Array(0);
  private sendTimer: number | null = null;

  constructor(onResult: RealtimeCallback) {
    this.onResult = onResult;
  }

  // 开始录音
  async start(): Promise<boolean> {
    try {
      // 1. 获取讯飞实时握手 URL
      const response = await fetch('/api/tingwu/realtime', { method: 'POST' });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '创建任务失败');
      }
      
      const wsUrl = data.wsUrl;
      this.sessionId = data.sessionId || crypto.randomUUID();
      this.lastSpeakerId = 'speaker_1';
      this.pcmBuffer = new Uint8Array(0);
      
      console.log('[讯飞] 握手 URL 已就绪, SessionId:', this.sessionId);
      
      // 2. 连接 WebSocket
      this.ws = new WebSocket(wsUrl);
      
      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(false);
          return;
        }
        
        this.ws.onopen = async () => {
          console.log('[讯飞] WebSocket 连接成功');

          // 启动麦克风与音频发送循环
          const micSuccess = await this.startMicrophone();
          resolve(micSuccess);
        };
        
        this.ws.onerror = (error) => {
          console.error('[讯飞] WebSocket 错误:', error);
          reject(false);
        };
        
        this.ws.onclose = (event) => {
          console.log('[讯飞] WebSocket 关闭:', event.code, event.reason);
        };
        
        this.ws.onmessage = (event) => {
          if (typeof event.data === 'string') {
            this.handleMessage(event.data);
          }
        };
      });
    } catch (error) {
      console.error('[讯飞] 启动失败:', error);
      return false;
    }
  }

  // 停止录音
  async stop(): Promise<void> {
    this.isRecordingFlag = false;
    this.stopSendLoop();
    
    // 发送结束消息（讯飞协议）
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      if (this.pcmBuffer.byteLength > 0) {
        this.ws.send(new Uint8Array(this.pcmBuffer));
        this.pcmBuffer = new Uint8Array(0);
      }

      const stopMessage = {
        end: true,
        sessionId: this.sessionId || crypto.randomUUID(),
      };
      this.ws.send(JSON.stringify(stopMessage));
      console.log('[讯飞] 已发送结束消息');
      
      await new Promise(resolve => setTimeout(resolve, 500));
      this.ws.close();
      this.ws = null;
    }
    
    // 关闭音频处理
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this.sessionId = null;
    this.lastSpeakerId = 'speaker_1';
    this.pcmBuffer = new Uint8Array(0);
    
    console.log('[讯飞] 录音已停止');
  }

  get isRecording(): boolean {
    return this.isRecordingFlag;
  }

  get currentTaskId(): string | null {
    return this.sessionId;
  }

  private appendPcmChunk(chunk: Uint8Array) {
    const merged = new Uint8Array(this.pcmBuffer.byteLength + chunk.byteLength);
    merged.set(this.pcmBuffer, 0);
    merged.set(chunk, this.pcmBuffer.byteLength);
    this.pcmBuffer = merged;
  }

  private startSendLoop() {
    if (this.sendTimer !== null) return;

    // 讯飞文档建议：每40ms发送1280字节（16k/16bit/单声道）
    this.sendTimer = window.setInterval(() => {
      if (!this.isRecordingFlag || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      if (this.pcmBuffer.byteLength < 1280) {
        return;
      }

      const frame = this.pcmBuffer.slice(0, 1280);
      this.pcmBuffer = this.pcmBuffer.slice(1280);
      this.ws.send(frame);
    }, 40);
  }

  private stopSendLoop() {
    if (this.sendTimer !== null) {
      window.clearInterval(this.sendTimer);
      this.sendTimer = null;
    }
  }

  // 线性插值重采样函数
  private resample(inputData: Float32Array, inputSampleRate: number, targetSampleRate: number): Float32Array {
    if (inputSampleRate === targetSampleRate) {
      return inputData;
    }
    
    const ratio = inputSampleRate / targetSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const outputData = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      
      outputData[i] = inputData[srcIndexFloor] * (1 - fraction) + 
                     inputData[srcIndexCeil] * fraction;
    }
    
    return outputData;
  }

  // 启动麦克风
  private async startMicrophone(): Promise<boolean> {
    try {
      // 获取麦克风权限
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
        } 
      });
      
      this.audioContext = new AudioContext();
      const actualSampleRate = this.audioContext.sampleRate;
      const targetSampleRate = 16000;
      
      console.log(`[讯飞] 浏览器实际采样率: ${actualSampleRate}Hz, 目标采样率: ${targetSampleRate}Hz`);
      
      if (actualSampleRate !== targetSampleRate) {
        console.log(`[讯飞] 需要重采样: ${actualSampleRate}Hz -> ${targetSampleRate}Hz`);
      }
      
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
      
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isRecordingFlag) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        let pcmData: Int16Array;
        
        if (actualSampleRate !== targetSampleRate) {
          const resampledData = this.resample(inputData, actualSampleRate, targetSampleRate);
          pcmData = new Int16Array(resampledData.length);
          for (let i = 0; i < resampledData.length; i++) {
            let sample = resampledData[i];
            sample = Math.max(-1, Math.min(1, sample));
            pcmData[i] = Math.floor(sample * 32767);
          }
        } else {
          pcmData = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            let sample = inputData[i];
            sample = Math.max(-1, Math.min(1, sample));
            pcmData[i] = Math.floor(sample * 32767);
          }
        }
        
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          const chunk = new Uint8Array(pcmData.buffer.slice(0));
          this.appendPcmChunk(chunk);
        }
      };
      
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      await this.audioContext.resume();
      
      this.isRecordingFlag = true;
      this.startSendLoop();
      console.log('[讯飞] 麦克风已启动，音频处理已开始');
      return true;
      
    } catch (error) {
      console.error('[讯飞] 麦克风启动失败:', error);
      return false;
    }
  }

  private normalizeSpeaker(rawRl: unknown): string {
    const rl = Number(rawRl);
    if (Number.isNaN(rl) || rl === 0) {
      return this.lastSpeakerId;
    }

    // 产品要求仅区分说话人 1/2/3，超过3统一归并到3。
    const n = rl <= 1 ? 1 : rl === 2 ? 2 : 3;
    const speakerId = `speaker_${n}`;
    this.lastSpeakerId = speakerId;
    return speakerId;
  }

  private extractTextAndSpeaker(message: any): { text: string; speakerId: string; isFinal: boolean } | null {
    const data = message?.data;
    const st = data?.cn?.st;
    const rtList = st?.rt;
    if (!Array.isArray(rtList)) {
      return null;
    }

    let text = '';
    let speakerId = this.lastSpeakerId;

    for (const rt of rtList) {
      const wsList = rt?.ws;
      if (!Array.isArray(wsList)) continue;

      for (const ws of wsList) {
        const candidates = ws?.cw;
        if (!Array.isArray(candidates) || candidates.length === 0) continue;
        const first = candidates[0];
        if (typeof first?.w === 'string') {
          text += first.w;
        }
        speakerId = this.normalizeSpeaker(first?.rl);
      }
    }

    if (!text.trim()) {
      return null;
    }

    // 移除开头的标点符号
    text = text.replace(/^[。，、；：？！""''（）…·•※‥\s]+/, '').trim();

    // 如果全是标点符号，返回 null
    if (!text) {
      return null;
    }

    const isFinal = String(st?.type) === '0' || Boolean(data?.ls);
    return { text, speakerId, isFinal };
  }

  // 处理 WebSocket 消息（讯飞结果格式）
  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);

      if (message?.action === 'error') {
        console.error('[讯飞] 服务端错误:', message);
        return;
      }

      if (message?.msg_type === 'result' && message?.res_type === 'frc') {
        console.error('[讯飞] 异常结果:', message?.data || message);
        return;
      }

      if (message?.msg_type === 'result' && message?.res_type === 'asr') {
        const parsed = this.extractTextAndSpeaker(message);
        if (!parsed) {
          return;
        }

        this.onResult({
          text: parsed.text,
          speakerId: parsed.speakerId,
          isFinal: parsed.isFinal,
        });
        return;
      }

      if (message?.action === 'started') {
        console.log('[讯飞] 握手完成:', message?.sid || '');
      }
    } catch (error) {
      console.error('[讯飞] 消息解析失败:', error, '原始数据:', data);
    }
  }
}