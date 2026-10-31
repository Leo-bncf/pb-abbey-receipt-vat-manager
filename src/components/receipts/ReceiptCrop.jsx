/* Shows just the receipt, cropped out of its source page using the bounding box
 * the scanner returned (box_2d = [ymin, xmin, ymax, xmax], 0–1000 of the page).
 * PDFs are rendered with pdf.js (loaded lazily, cached per file); images are
 * cropped directly. Falls back to the whole page when there is no box. */
import React, { useEffect, useState } from 'react';
import { RotateCw, Maximize2, Minimize2, Loader2 } from 'lucide-react';

const docCache = new Map(); // file_url -> Promise<PDFDocumentProxy>

async function loadPdf(url) {
  if (!docCache.has(url)) {
    docCache.set(url, (async () => {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs.getDocument({ url }).promise;
    })());
  }
  return docCache.get(url);
}

async function pageCanvas(url, fileType, pageNumber) {
  if (fileType === 'pdf' || /\.pdf($|\?)/i.test(url)) {
    const pdf = await loadPdf(url);
    const page = await pdf.getPage(Math.min(Math.max(1, pageNumber || 1), pdf.numPages));
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 2200 / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return canvas;
  }
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas;
}

function crop(canvas, box) {
  if (!Array.isArray(box) || box.length !== 4) return canvas.toDataURL('image/jpeg', 0.9);
  const [y0, x0, y1, x1] = box;
  const pad = 15; // 1.5% margin so the paper edge isn't clipped
  const sx = Math.max(0, (x0 - pad) / 1000 * canvas.width), sy = Math.max(0, (y0 - pad) / 1000 * canvas.height);
  const ex = Math.min(canvas.width, (x1 + pad) / 1000 * canvas.width), ey = Math.min(canvas.height, (y1 + pad) / 1000 * canvas.height);
  const out = document.createElement('canvas');
  out.width = Math.max(1, ex - sx); out.height = Math.max(1, ey - sy);
  out.getContext('2d').drawImage(canvas, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', 0.92);
}

export default function ReceiptCrop({ fileUrl, fileType, pageNumber, box, className = '' }) {
  const [src, setSrc] = useState(null);
  const [full, setFull] = useState(null);
  const [showFull, setShowFull] = useState(false);
  const [rot, setRot] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setSrc(null); setFull(null); setErr(null); setShowFull(false); setRot(0);
    if (!fileUrl) return;
    pageCanvas(fileUrl, fileType, pageNumber)
      .then((c) => { if (alive) { setSrc(crop(c, box)); setFull(c.toDataURL('image/jpeg', 0.85)); } })
      .catch((e) => alive && setErr(String(e?.message || e)));
    return () => { alive = false; };
  }, [fileUrl, fileType, pageNumber, JSON.stringify(box)]);

  if (err) return <div className={`flex items-center justify-center text-[12px] text-red-300 p-4 ${className}`}>Could not load the document: {err}</div>;
  if (!src) return <div className={`flex items-center justify-center text-neutral-400 ${className}`}><Loader2 className="w-5 h-5 animate-spin" /></div>;

  const hasBox = Array.isArray(box) && box.length === 4;
  return (
    <div className={`relative flex flex-col ${className}`}>
      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center bg-neutral-900">
        <img src={showFull ? full : src} alt="Receipt" className="max-w-full max-h-full object-contain transition-transform"
          style={{ transform: `rotate(${rot}deg)` }} />
      </div>
      <div className="absolute top-2 right-2 flex gap-1.5">
        <button type="button" onClick={() => setRot((r) => (r + 90) % 360)} title="Rotate"
          className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white shadow"><RotateCw className="w-4 h-4" /></button>
        {hasBox && (
          <button type="button" onClick={() => setShowFull((v) => !v)} title={showFull ? 'Show this receipt only' : 'Show the whole page'}
            className="p-1.5 rounded bg-white/90 text-neutral-800 hover:bg-white shadow">
            {showFull ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        )}
      </div>
      {!hasBox && <p className="text-[11px] text-neutral-400 mt-2">Scanned before receipt cropping existed — showing the whole page{pageNumber ? ` ${pageNumber}` : ''}.</p>}
    </div>
  );
}
