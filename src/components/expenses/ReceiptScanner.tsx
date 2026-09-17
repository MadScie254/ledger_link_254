import React, { useState, useRef, useEffect } from 'react';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';

interface ReceiptScannerProps {
  onScanComplete: (data: { vendor: string; amount: number; date: string }) => void;
  onClose: () => void;
}

export function ReceiptScanner({ onScanComplete, onClose }: ReceiptScannerProps) {
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraTried, setCameraTried] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Held in a ref so the unmount cleanup stops the stream that is actually open.
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setHasCamera(false);
  };

  const startCamera = async () => {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = ms;
      if (videoRef.current) videoRef.current.srcObject = ms;
      setHasCamera(true);
    } catch {
      setError('The camera could not be opened. Upload a photo of the receipt instead.');
    } finally {
      setCameraTried(true);
    }
  };

  useEffect(() => {
    startCamera();
    return stopCamera;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const processImage = async (base64Data: string, mimeType: string) => {
    setIsScanning(true);
    setError('');
    stopCamera();
    try {
      const res = await fetch('/api/expenses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data, mimeType }),
      });
      if (!res.ok) throw new Error('The receipt could not be read. Try a sharper, well-lit photo.');
      onScanComplete(await res.json());
    } catch (err: any) {
      setError(err.message || 'The receipt could not be read.');
      setIsScanning(false);
      startCamera();
    }
  };

  const captureImage = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    processImage(canvas.toDataURL('image/jpeg').split(',')[1], 'image/jpeg');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => processImage((event.target?.result as string).split(',')[1], file.type || 'image/jpeg');
    reader.readAsDataURL(file);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Read a receipt"
      note="The supplier, amount and date are read from the photo for you to check before saving."
      footer={
        !isScanning && (
          <>
            <label className={`${buttonClass.secondary} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-oxblood`}>
              Upload a photo
              <input type="file" accept="image/*" className="sr-only" onChange={handleFileUpload} />
            </label>
            <button type="button" onClick={captureImage} disabled={!hasCamera} className={buttonClass.primary}>
              Take the photo
            </button>
          </>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-3 text-[13.5px] text-ledger-red">
          {error}
        </p>
      )}
      <div className="relative flex min-h-[16rem] items-center justify-center border border-feint-strong bg-paper-200">
        {isScanning ? (
          <p className="text-[14px] text-ink-900" role="status">
            Reading the receipt
          </p>
        ) : (
          <>
            <video ref={videoRef} autoPlay playsInline muted className="max-h-[60vh] w-full object-cover" style={{ display: hasCamera ? 'block' : 'none' }} />
            {!hasCamera && <p className="px-6 text-center text-[13.5px] text-graphite-600">{cameraTried ? 'No camera. Upload a photo of the receipt.' : 'Opening the camera'}</p>}
          </>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>
    </Dialog>
  );
}
