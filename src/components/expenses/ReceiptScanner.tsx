import React, { useState, useRef, useEffect } from 'react';
import type { ScannedReceipt } from '../../utils/aiReceipt';
import { Dialog } from '../ledger/Dialog';
import { buttonClass } from '../ledger/Page';
import type { ScannedForBill } from './BillBuilder';

interface ReceiptScannerProps {
  /** What was read, and the photo itself, to keep with the expense. */
  onScanComplete: (data: ScannedForBill) => void;
  onClose: () => void;
}

/** The longest side a photo is sent at: enough to read a receipt, and fewer AI units than a full-size photo. */
const MAX_SIDE = 1600;

/**
 * The photo as a JPEG no larger than MAX_SIDE. Phones save HEIC and very
 * large images; the reading model takes JPEG, PNG or WebP, and a smaller
 * photo is read faster. A photo the browser cannot open is refused here.
 */
function asJpeg(source: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This photo cannot be opened here. Take the photo with the camera, or upload a JPEG or PNG.'));
    };
    image.src = url;
  });
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

  const processImage = async (photo: Blob, original?: File) => {
    setIsScanning(true);
    setError('');
    stopCamera();
    try {
      const base64Data = await asJpeg(photo);
      const res = await fetch('/api/expenses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Data, mimeType: 'image/jpeg' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // The Worker's own sentences (AI off, limits, a photo it could not read) explain themselves.
        throw new Error(data.error || 'The receipt could not be read. Try a sharper, well-lit photo.');
      }
      const read = (await res.json()) as ScannedReceipt;
      const receipt = original || new File([photo], `receipt-${new Date().toISOString().slice(0, 10)}.jpg`, { type: photo.type || 'image/jpeg' });
      onScanComplete({
        vendor: read.vendorName,
        amountCents: read.totalAmountCents,
        taxCents: read.taxAmountCents,
        currency: read.currency,
        date: read.date || '',
        receipt,
      });
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
    canvas.toBlob((blob) => { if (blob) processImage(blob); }, 'image/jpeg', 0.9);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImage(file, file);
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
