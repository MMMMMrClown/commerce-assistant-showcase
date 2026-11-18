// 浏览器录音格式不同，统一转成16kHz单声道PCM WAV供识别接口读取。
export function pcmWav(samples: Float32Array, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const label = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  label(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  label(8, 'WAVE');
  label(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  label(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function recordedAudioToWav(blob: Blob) {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (audio.duration < 0.5 || audio.duration > 60.1) throw new Error('请录制0.5至60秒的语音');
    const renderer = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const source = renderer.createBufferSource();
    source.buffer = audio;
    source.connect(renderer.destination);
    source.start();
    return pcmWav((await renderer.startRendering()).getChannelData(0));
  } finally {
    await context.close();
  }
}
