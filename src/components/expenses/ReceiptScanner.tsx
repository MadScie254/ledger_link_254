import React from 'react';
import { useState, useRef, useEffect } from 'react';
import { Camera, Upload, X, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store';

interface ReceiptScannerProps {
  onScanComplete: (data: { vendor: string; amount: number; date: string }) => void;
  onClose: () => void;
}

export function ReceiptScanner({ onScanComplete, onClose }: ReceiptScannerProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    startCamera();
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(ms);
      if (videoRef.current) {
        videoRef.current.srcObject = ms;
      }
    } catch (err: any) {
      setError('Could not access camera. Try uploading an image instead.');
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const base64Data = canvas.toDataURL('image/jpeg').split(',')[1];
        processImage(base64Data);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Data = (event.target?.result as string).split(',')[1];
        processImage(base64Data);
      };
      reader.readAsDataURL(file);
    }
  };

  const processImage = async (base64Data: string) => {
    setIsScanning(true);
    setError('');
    stopCamera(); // Stop camera while processing to save resources
    
    try {
      const res = await fetch('/api/expenses/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Data })
      });
      
      if (!res.ok) {
        throw new Error('Failed to scan receipt');
      }
      
      const data = await res.json();
      onScanComplete(data);
    } catch (err: any) {
      setError(err.message || 'Error processing receipt.');
      setIsScanning(false);
      startCamera(); // Restart camera if failed
    }
  };

  return (
    <div className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-[#111827] rounded-lg shadow-2xl w-full max-w-lg overflow-hidden border border-ink-900/10">
        <div className="flex justify-between items-center p-4 border-b border-ink-900/10">
          <h3 className="text-lg font-medium text-ink-900">Scan Receipt</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-ink-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        
        <div className="p-4 flex flex-col items-center justify-center bg-paper-50 relative min-h-[300px]">
          {isScanning ? (
            <div className="flex flex-col items-center justify-center text-focus-blue-500 py-12">
              <Loader2 className="h-12 w-12 animate-spin mb-4" />
              <p className="font-medium">AI is extracting details...</p>
            </div>
          ) : (
            <>
              {error && <div className="absolute top-4 left-4 right-4 bg-rust-700/10 text-rust-700 p-3 rounded-sm text-sm text-center">{error}</div>}
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full rounded-sm max-h-[60vh] object-cover"
                style={{ display: stream ? 'block' : 'none' }}
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />
              
              {!stream && !error && (
                <div className="text-slate-500 text-center py-12">
                  <Camera className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>Initializing camera...</p>
                </div>
              )}
            </>
          )}
        </div>
        
        {!isScanning && (
          <div className="p-4 bg-white dark:bg-[#111827] border-t border-ink-900/10 flex flex-col space-y-3">
            <button 
              onClick={captureImage} 
              disabled={!stream}
              className="w-full bg-focus-blue-500 text-white dark:text-slate-900 font-medium py-3 rounded-sm hover:bg-focus-blue-600 transition-colors disabled:opacity-50"
            >
              Capture Receipt
            </button>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-ink-900/10"></div></div>
              <div className="relative flex justify-center text-sm"><span className="bg-white dark:bg-[#111827] px-2 text-slate-500">Or</span></div>
            </div>
            <label className="w-full cursor-pointer bg-white dark:bg-[#111827] border border-ink-900/20 text-ink-900 font-medium py-2 rounded-sm hover:bg-paper-50 transition-colors flex items-center justify-center">
              <Upload className="h-4 w-4 mr-2 text-slate-500" />
              Upload Image
              <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
