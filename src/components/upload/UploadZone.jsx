import React, { useState, useCallback } from 'react';
import { Upload, FileText, Image, X, Loader2, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Phone photos are 3–5 MB; ~2000 px JPEG is plenty to read a till receipt and
// uploads in a second on mobile data. Also normalises iPhone formats to JPEG.
async function compressPhoto(file, index) {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.');
  const name = `Receipt photo ${stamp}${index ? `-${index + 1}` : ''}.jpg`;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return new File([blob], name, { type: 'image/jpeg' });
  } catch {
    // Browser can't decode it (e.g. HEIC on desktop Chrome): send as-is if it's a usable type.
    return /image\/(jpe?g|png)/.test(file.type) ? new File([file], name.replace('.jpg', file.type === 'image/png' ? '.png' : '.jpg'), { type: file.type }) : null;
  }
}

export default function UploadZone({ onFilesSelected, isProcessing }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);

  const acceptedTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
  const acceptedExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(file => 
      acceptedTypes.includes(file.type) || 
      acceptedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
    }
  }, []);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files).filter(file => 
      acceptedTypes.includes(file.type) || 
      acceptedExtensions.some(ext => file.name.toLowerCase().endsWith(ext))
    );
    if (files.length > 0) {
      setSelectedFiles(prev => [...prev, ...files]);
    }
  };

  const handlePhotos = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = ''; // allow taking another photo straight away
    const out = (await Promise.all(picked.map((f, i) => compressPhoto(f, picked.length > 1 ? i : 0)))).filter(Boolean);
    if (out.length) setSelectedFiles(prev => [...prev, ...out]);
    if (out.length < picked.length) alert('Some photos could not be read. Please take them again (JPEG/PNG).');
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = () => {
    if (selectedFiles.length > 0) {
      onFilesSelected(selectedFiles);
      setSelectedFiles([]);
    }
  };

  const getFileIcon = (file) => {
    if (file.type === 'application/pdf') {
      return <FileText className="w-4 h-4 text-neutral-400 shrink-0" />;
    }
    return <Image className="w-4 h-4 text-neutral-400 shrink-0" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div>
      {/* Phone: one tap = camera; one photo = one receipt (the most accurate way to scan). */}
      <label className={`flex items-center justify-center gap-2.5 w-full h-12 bg-neutral-900 text-white text-[14px] font-medium cursor-pointer hover:bg-neutral-800 transition-colors ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
        <Camera className="w-4 h-4" /> Photograph a receipt
        <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={handlePhotos} disabled={isProcessing} />
      </label>
      <p className="mt-2 text-[12px] text-neutral-500">One receipt per photo, flat and in good light. Take as many as you like, then press <span className="font-medium text-neutral-800">Send for reading</span>.</p>

      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}
        className={`relative mt-4 border border-dashed px-5 py-7 text-center transition-colors ${isDragOver ? 'border-neutral-900 bg-white' : 'border-neutral-300 bg-white/60 hover:bg-white'}`}>
        <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelect} disabled={isProcessing}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
        <Upload className="w-5 h-5 text-neutral-400 mx-auto mb-2" />
        <p className="text-[13px] text-neutral-800 font-medium">{isDragOver ? 'Drop the files here' : 'Choose files or drop them here'}</p>
        <p className="text-[12px] text-neutral-400 mt-0.5">PDF, JPG or PNG — a whole statement PDF is fine</p>
      </div>

      {selectedFiles.length > 0 && (
        <div className="mt-4 bg-white border rule">
          <ul className="divide-y divide-neutral-100">
            {selectedFiles.map((file, index) => (
              <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
                {getFileIcon(file)}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-neutral-900 truncate">{file.name}</p>
                  <p className="text-[11px] text-neutral-400 font-fig">{formatFileSize(file.size)}</p>
                </div>
                <button onClick={() => removeFile(index)} disabled={isProcessing} title="Remove" className="p-1.5 text-neutral-400 hover:text-neutral-900"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
          <div className="px-4 py-3 border-t rule flex items-center justify-between gap-3">
            <span className="text-[12px] text-neutral-500">{selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} ready</span>
            <Button onClick={handleUpload} disabled={isProcessing} className="bg-neutral-900 hover:bg-neutral-800 rounded-none">
              {isProcessing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : <>Send for reading</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
