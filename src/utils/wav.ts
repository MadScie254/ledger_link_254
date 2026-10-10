/**
 * Spoken questions are sent as 16 kHz mono 16-bit WAV: a format the speech
 * model reads whatever the phone recorded in (webm, mp4 or ogg), and small,
 * at 32 KB a second.
 */

export const SPEECH_SAMPLE_RATE = 16_000;

/** Averages channels into one and resamples to the target rate by linear interpolation. */
export function toMono16k(channels: Float32Array[], sampleRate: number, targetRate = SPEECH_SAMPLE_RATE): Float32Array {
  if (channels.length === 0 || channels[0].length === 0) return new Float32Array(0);
  const length = channels[0].length;
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  if (sampleRate === targetRate) return mono;
  const outLength = Math.max(1, Math.round((length * targetRate) / sampleRate));
  const out = new Float32Array(outLength);
  const step = (length - 1) / Math.max(outLength - 1, 1);
  for (let i = 0; i < outLength; i++) {
    const position = i * step;
    const left = Math.floor(position);
    const right = Math.min(left + 1, length - 1);
    out[i] = mono[left] + (mono[right] - mono[left]) * (position - left);
  }
  return out;
}

/** A WAV file of 16-bit samples. */
export function encodeWav(samples: Float32Array, sampleRate = SPEECH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** Base64 of bytes, in pieces small enough for String.fromCharCode. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
