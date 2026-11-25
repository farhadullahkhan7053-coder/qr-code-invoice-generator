// QR code rendering (qrcode-generator) and camera scanning.
//
// Scanning prefers the native BarcodeDetector where the browser offers
// it and falls back to jsQR over canvas frames. Every failure path
// (no camera, permission denied, unsupported browser) lands on a manual
// invoice-number entry, so the flow never dead-ends.

import { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import jsQR from "jsqr";

export function QrCode({ text, size = 96 }: { text: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
    } catch {
      return null;
    }
  }, [text]);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label="QR code for this invoice"
      style={{ width: size, height: size }}
      className="shrink-0 [&>svg]:h-full [&>svg]:w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

type DetectorResult = { rawValue?: string };
type Detector = {
  detect: (source: HTMLVideoElement) => Promise<DetectorResult[]>;
};
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

function getBarcodeDetector(): Detector | null {
  const w = window as unknown as { BarcodeDetector?: DetectorCtor };
  if (!w.BarcodeDetector) return null;
  try {
    return new w.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
}

export function QrScanner({
  title,
  onResult,
  onClose,
}: {
  title: string;
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const finish = (text: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      onResult(text);
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can't open the camera here. Type the code or invoice number below instead.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError("Camera permission was not given. Type the code or invoice number below instead.");
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        /* autoplay policies: the preview still shows once playing */
      }

      const detector = getBarcodeDetector();
      if (detector) {
        const loop = async () => {
          if (stopped || doneRef.current) return;
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((c) => c.rawValue);
            if (hit?.rawValue) {
              finish(hit.rawValue);
              return;
            }
          } catch {
            /* keep trying next frame */
          }
          raf = requestAnimationFrame(() => {
            timer = setTimeout(loop, 200);
          });
        };
        void loop();
      } else {
        const canvas = document.createElement("canvas");
        const tick = () => {
          if (stopped || doneRef.current) return;
          if (video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx2d = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx2d) {
              ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
              const img = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height);
              if (code?.data) {
                finish(code.data);
                return;
              }
            }
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      }
    };
    void start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="card w-full max-w-md p-4 text-[var(--text)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display font-bold text-base">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-full border border-[var(--border)] text-sm font-medium"
          >
            Close
          </button>
        </div>
        {!error ? (
          <video
            ref={videoRef}
            playsInline
            muted
            className="mt-3 w-full rounded-xl bg-black aspect-square object-cover"
            aria-label="Camera view for scanning"
          />
        ) : (
          <p className="mt-3 text-sm rounded-xl bg-[var(--surface-alt)] px-3 py-3" role="alert">
            {error}
          </p>
        )}
        <p className="mt-3 text-sm text-[var(--dim)]">
          Point the camera at the QR code on the invoice — or type the invoice number (like
          INV-0007) or paste the code text here:
        </p>
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onResult(manual.trim());
          }}
        >
          <input
            aria-label="Invoice number or QR code text"
            className="w-full border border-[var(--border)] rounded-lg px-3 py-2 bg-[var(--surface)]"
            placeholder="INV-0007"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            type="submit"
            disabled={!manual.trim()}
            className="shrink-0 px-4 rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] font-semibold text-sm disabled:opacity-50"
          >
            Open
          </button>
        </form>
      </div>
    </div>
  );
}

/** Pulls an INV-#### number out of scanned QR text or typed input. */
export function invoiceNumberFromScan(text: string): string | null {
  const m = text.match(/INV-\d+/i);
  if (m) return m[0].toUpperCase();
  const trimmed = text.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}
