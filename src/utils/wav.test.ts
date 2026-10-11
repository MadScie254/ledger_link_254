import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToBase64, encodeWav, toMono16k } from './wav.ts';

test('a WAV file carries a 16 kHz mono 16-bit header and the samples', () => {
  const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]));
  const view = new DataView(wav.buffer);
  const text = (offset: number, length: number) => String.fromCharCode(...wav.subarray(offset, offset + length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(view.getUint16(22, true), 1, 'mono');
  assert.equal(view.getUint32(24, true), 16_000);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 8, 'four samples of two bytes');
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)], [0, 32767, -32768, 16383]);
  assert.equal(wav.length, 52);
});

test('stereo at 48 kHz becomes mono at 16 kHz', () => {
  const left = new Float32Array(48_000).fill(0.5);
  const right = new Float32Array(48_000).fill(-0.5);
  const mono = toMono16k([left, right], 48_000);
  assert.equal(mono.length, 16_000);
  assert.ok(mono.every((sample) => Math.abs(sample) < 1e-6), 'the two channels cancel');
  const same = toMono16k([new Float32Array([0.25, 0.5])], 16_000);
  assert.deepEqual([...same], [0.25, 0.5]);
  assert.equal(toMono16k([], 44_100).length, 0);
});

test('bytes become base64 in pieces without losing any', () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
  assert.equal(Buffer.from(bytesToBase64(bytes), 'base64').equals(Buffer.from(bytes)), true);
});
