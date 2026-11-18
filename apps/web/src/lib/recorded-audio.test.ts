import { expect, it } from 'vitest';
import { pcmWav } from './recorded-audio';

it('录音编码为后端接受的16kHz单声道16位PCM WAV，样本越界被裁剪', async () => {
  const samples = new Float32Array(16000);
  samples[0] = -2;
  samples[1] = 2;
  samples[2] = 0;
  const blob = pcmWav(samples);
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
  const view = new DataView(buffer);
  expect(blob.type).toBe('audio/wav');
  expect(buffer.byteLength).toBe(32044);
  expect(view.getUint32(4, true)).toBe(32036);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint32(40, true)).toBe(32000);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(view.getInt16(46, true)).toBe(32767);
  expect(view.getInt16(48, true)).toBe(0);
});
