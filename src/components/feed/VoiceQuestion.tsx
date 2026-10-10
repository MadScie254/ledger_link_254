import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { apiRequest } from '../../utils/apiRequest';
import { bytesToBase64, encodeWav, toMono16k } from '../../utils/wav';
import { buttonClass } from '../ledger/Page';

const MAX_SECONDS = 30;

export const canRecordVoice = () =>
  typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof (window as any).MediaRecorder !== 'undefined';

/**
 * Records a spoken question and returns it as text for the person to check
 * before asking. Recording stops itself after 30 seconds.
 */
export function VoiceQuestion({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'recording' | 'reading'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [problem, setProblem] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const stopTracks = () => {
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopTracks, []);

  const transcribe = async (blob: Blob) => {
    setState('reading');
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
      const wav = encodeWav(toMono16k(channels, decoded.sampleRate));
      void context.close();
      const { text } = await apiRequest<{ text: string }>('/api/ai/transcribe', {
        body: { audio: bytesToBase64(wav) },
        fallback: 'The recording could not be turned into text. Type the question instead.',
      });
      onText(text);
    } catch (err) {
      setProblem((err as Error).message || 'The recording could not be turned into text. Type the question instead.');
    } finally {
      setState('idle');
    }
  };

  const start = async () => {
    setProblem('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = () => {
        stopTracks();
        void transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState('recording');
      timer.current = window.setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS && rec.state === 'recording') rec.stop();
          return s + 1;
        });
      }, 1000);
    } catch {
      setProblem('The microphone could not be opened. Allow it for this site, or type the question.');
    }
  };

  const stop = () => { if (recorder.current?.state === 'recording') recorder.current.stop(); };

  return (
    <div className="flex flex-col items-start gap-1">
      {state === 'recording' ? (
        <button type="button" onClick={stop} className={`${buttonClass.secondary} h-10`} aria-live="polite">
          <Square className="h-4 w-4" aria-hidden="true" /> Stop · <span className="ll-figure">{MAX_SECONDS - seconds}</span>s left
        </button>
      ) : (
        <button type="button" onClick={start} disabled={disabled || state === 'reading'} className={`${buttonClass.secondary} h-10`}>
          <Mic className="h-4 w-4" aria-hidden="true" /> {state === 'reading' ? 'Listening' : 'Speak'}
        </button>
      )}
      {problem && <p role="alert" className="text-[12.5px] text-ledger-red">{problem}</p>}
    </div>
  );
}
