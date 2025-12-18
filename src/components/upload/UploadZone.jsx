import React, { useState, useCallback } from 'react';
import { Upload, FileText, Image, X, Loader2, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

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
      return <FileText className="w-5 h-5 text-red-500" />;
    }
    return <Image className="w-5 h-5 text-blue-500" />;
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6">
      <motion.div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer
          ${isDragOver 
            ? 'border-indigo-500 bg-indigo-50/50' 
            : 'border-slate-200 hover:border-slate-300 bg-slate-50/30'
          }
        `}
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
      >
        <input
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileSelect}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isProcessing}
        />
        
        <motion.div
          animate={{ y: isDragOver ? -5 : 0 }}
          transition={{ duration: 0.2 }}
          className="flex flex-col items-center"
        >
          <div className={`
            w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-colors duration-300
            ${isDragOver ? 'bg-indigo-100' : 'bg-slate-100'}
          `}>
            <Upload className={`w-8 h-8 ${isDragOver ? 'text-indigo-600' : 'text-slate-400'}`} />
          </div>
          
          <h3 className="text-lg font-semibold text-slate-800 mb-2">
            {isDragOver ? 'Drop files here' : 'Upload Receipts'}
          </h3>
          <p className="text-slate-500 text-sm mb-4">
            Drag and drop your receipts or click to browse
          </p>
          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <FileText className="w-3 h-3" /> PDF
            </span>
            <span className="flex items-center gap-1">
              <Image className="w-3 h-3" /> JPG
            </span>
            <span className="flex items-center gap-1">
              <Image className="w-3 h-3" /> PNG
            </span>
          </div>
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {selectedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''} selected
              </span>
              <Button
                onClick={handleUpload}
                disabled={isProcessing}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    Process Receipts
                  </>
                )}
              </Button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
              {selectedFiles.map((file, index) => (
                <motion.div
                  key={`${file.name}-${index}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {getFileIcon(file)}
                    <div>
                      <p className="text-sm font-medium text-slate-800 truncate max-w-xs">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => removeFile(index)}
                    className="p-1 hover:bg-slate-200 rounded-lg transition-colors"
                    disabled={isProcessing}
                  >
                    <X className="w-4 h-4 text-slate-400" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}