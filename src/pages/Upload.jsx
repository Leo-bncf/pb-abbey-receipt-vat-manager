import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { FileText, ArrowRight, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { base44 } from '@/api/base44Client';
import UploadZone from '../components/upload/UploadZone';
import { createPageUrl } from '@/utils';

export default function Upload() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [processedFiles, setProcessedFiles] = useState([]);
  const [errors, setErrors] = useState([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const navigate = useNavigate();

  const getFileType = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return ext;
  };

  const processReceipt = async (fileUrl, fileName, fileType, batchId) => {
    // Fetch learned rules and corrections
    const feedbackData = await base44.entities.AIFeedback.list('-created_date', 50);
    const correctionsData = await base44.entities.ReceiptCorrection.list('-created_date', 100);
    
    // Build learning context
    let learningContext = '';
    
    if (feedbackData.length > 0) {
      learningContext += '\n\nLEARNED RULES AND PATTERNS:\n';
      feedbackData.forEach(f => {
        if (f.rule_learned) {
          learningContext += `- ${f.rule_learned}\n`;
        }
      });
    }
    
    if (correctionsData.length > 0) {
      learningContext += '\n\nPREVIOUS CORRECTIONS TO LEARN FROM:\n';
      const correctionsByField = {};
      correctionsData.forEach(c => {
        if (!correctionsByField[c.field_name]) {
          correctionsByField[c.field_name] = [];
        }
        correctionsByField[c.field_name].push({
          from: c.original_value,
          to: c.corrected_value,
          reason: c.correction_reason
        });
      });
      
      Object.entries(correctionsByField).forEach(([field, corrections]) => {
        learningContext += `\n${field}:\n`;
        corrections.slice(0, 5).forEach(c => {
          learningContext += `  • Originally extracted "${c.from}" but correct value was "${c.to}"`;
          if (c.reason) learningContext += ` (${c.reason})`;
          learningContext += '\n';
        });
      });
    }
    
    // Use AI to extract data from the receipt
    const extractionPrompt = `Analyze this receipt image/document and extract the following information:
    - vendor_name: The name of the vendor/store/company
    - receipt_date: The date on the receipt (format: YYYY-MM-DD)
    - country: The country where the purchase was made (infer from currency, language, or address)
    - currency: The currency code (GBP, EUR, USD, etc.)
    - total_amount: The total amount paid (number only)
    - vat_amount: The VAT/tax amount if explicitly shown (number only, null if not shown)
    - vat_rate: The VAT rate percentage if shown (number only)
    - vat_explicit: true if VAT was explicitly shown on the receipt, false otherwise
    - is_tax_free: true if this is clearly a tax-free receipt
    - ocr_text: The full text extracted from the receipt
    - extraction_notes: Any notes about the extraction (e.g., "VAT calculated from total", "Multiple items detected")
    
    Be accurate and only extract what you can clearly identify. If VAT is not shown, set vat_explicit to false and try to calculate it based on the country's standard rate.
    
    Common VAT rates by country:
    - UK: 20% standard
    - Germany: 19% standard
    - France: 20% standard
    - Netherlands: 21% standard
    - Spain: 21% standard
    - Italy: 22% standard
    
    If VAT is not explicit and you identify the country, calculate: VAT = Total - (Total / (1 + VAT_rate))

    ${learningContext}

    IMPORTANT: Apply the learned rules and corrections above to improve extraction accuracy. Pay special attention to patterns that were corrected before.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      file_urls: [fileUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          vendor_name: { type: 'string' },
          receipt_date: { type: 'string' },
          country: { type: 'string' },
          currency: { type: 'string' },
          total_amount: { type: 'number' },
          vat_amount: { type: 'number' },
          vat_rate: { type: 'number' },
          vat_explicit: { type: 'boolean' },
          is_tax_free: { type: 'boolean' },
          ocr_text: { type: 'string' },
          extraction_notes: { type: 'string' },
          confidence_score: { type: 'number', description: 'Your confidence in the extraction 0-100' }
        }
      }
    });

    // Calculate VAT if not explicit and not tax-free
    let vatAmount = result.vat_amount;
    let vatRate = result.vat_rate;
    
    // For EUR receipts, always set VAT to 0 (company policy: only track full amount)
    if (result.currency === 'EUR') {
      vatAmount = 0;
      vatRate = 0;
    } else if (!result.vat_explicit && !result.is_tax_free && result.total_amount && result.vat_rate) {
      vatAmount = result.total_amount - (result.total_amount / (1 + result.vat_rate / 100));
      vatAmount = Math.round(vatAmount * 100) / 100;
    }

    // Determine if needs review
    const needsReview = (result.confidence_score || 0) < 70 || 
                        !result.vendor_name || 
                        !result.total_amount;

    return {
      file_url: fileUrl,
      file_name: fileName,
      file_type: fileType,
      status: 'extracted',
      ocr_text: result.ocr_text || '',
      vendor_name: result.vendor_name || '',
      receipt_date: result.receipt_date || '',
      country: result.country || '',
      currency: result.currency || 'GBP',
      total_amount: result.total_amount || 0,
      vat_amount: vatAmount || 0,
      vat_rate: vatRate || 0,
      vat_explicit: result.vat_explicit || false,
      is_tax_free: result.is_tax_free || false,
      confidence_score: result.confidence_score || 50,
      needs_review: needsReview,
      is_reviewed: false,
      upload_batch: batchId,
      extraction_notes: result.extraction_notes || ''
    };
  };

  const handleFilesSelected = async (files) => {
    setIsProcessing(true);
    setUploadProgress({ current: 0, total: files.length });
    setProcessedFiles([]);
    setErrors([]);
    setElapsedTime(0);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const batchId = `batch_${Date.now()}`;
    const results = [];
    const errorList = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress({ current: i + 1, total: files.length });

      try {
        // Upload file
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        
        // Process with AI
        const receiptData = await processReceipt(file_url, file.name, getFileType(file), batchId);
        
        // Save to database
        const savedReceipt = await base44.entities.Receipt.create(receiptData);
        
        results.push({ ...savedReceipt, success: true });
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        errorList.push({ fileName: file.name, error: error.message });
      }
    }

    clearInterval(timerInterval);
    setProcessedFiles(results);
    setErrors(errorList);
    setIsProcessing(false);
  };

  const totalVAT = processedFiles
    .filter(f => f.success)
    .reduce((sum, f) => sum + (f.vat_amount || 0), 0);

  const totalAmount = processedFiles
    .filter(f => f.success)
    .reduce((sum, f) => sum + (f.total_amount || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-100 mb-6">
            <FileText className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-3xl font-bold text-slate-800 mb-3">
            Upload Receipts
          </h1>
          <p className="text-slate-500 max-w-md mx-auto">
            Upload your receipts and our AI will automatically extract vendor details, amounts, and calculate VAT.
          </p>
        </motion.div>

        {/* Upload Zone */}
        {!isProcessing && processedFiles.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <UploadZone 
              onFilesSelected={handleFilesSelected}
              isProcessing={isProcessing}
            />
          </motion.div>
        )}

        {/* Processing Progress */}
        {isProcessing && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl border border-slate-200 p-8 text-center"
          >
            <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-800 mb-2">
              Processing Receipts
            </h3>
            <p className="text-slate-500 mb-4">
              Extracting data from {uploadProgress.current} of {uploadProgress.total} files...
            </p>
            <div className="text-2xl font-bold text-indigo-600 mb-6">
              {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
            </div>
            <Progress 
              value={(uploadProgress.current / uploadProgress.total) * 100} 
              className="h-2"
            />
          </motion.div>
        )}

        {/* Results */}
        {!isProcessing && processedFiles.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-8">
              <div className="flex items-center justify-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-2xl bg-green-100 flex items-center justify-center">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
              </div>
              <h3 className="text-xl font-semibold text-slate-800 text-center mb-2">
                Processing Complete
              </h3>
              <p className="text-slate-500 text-center mb-2">
                Successfully processed {processedFiles.filter(f => f.success).length} of {processedFiles.length + errors.length} receipts
              </p>
              <p className="text-sm text-slate-400 text-center mb-8">
                Completed in {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
              </p>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="text-center p-4 bg-slate-50 rounded-xl">
                  <p className="text-2xl font-bold text-slate-800">
                    {processedFiles.filter(f => f.success).length}
                  </p>
                  <p className="text-sm text-slate-500">Receipts</p>
                </div>
                <div className="text-center p-4 bg-indigo-50 rounded-xl">
                  <p className="text-2xl font-bold text-indigo-600">
                    £{totalAmount.toFixed(2)}
                  </p>
                  <p className="text-sm text-slate-500">Total Amount</p>
                </div>
                <div className="text-center p-4 bg-emerald-50 rounded-xl">
                  <p className="text-2xl font-bold text-emerald-600">
                    £{totalVAT.toFixed(2)}
                  </p>
                  <p className="text-sm text-slate-500">Total VAT</p>
                </div>
              </div>

              {errors.length > 0 && (
                <div className="mb-6 p-4 bg-red-50 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-red-600" />
                    <span className="font-medium text-red-800">
                      {errors.length} file(s) failed to process
                    </span>
                  </div>
                  <ul className="text-sm text-red-600 space-y-1">
                    {errors.map((err, i) => (
                      <li key={i}>{err.fileName}: {err.error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex gap-4 justify-center">
                <Button
                  variant="outline"
                  onClick={() => {
                    setProcessedFiles([]);
                    setErrors([]);
                  }}
                >
                  Upload More
                </Button>
                <Button
                  onClick={() => navigate(createPageUrl('Dashboard'))}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  View Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>

            {/* Processed Files List */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="font-semibold text-slate-800">Processed Receipts</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {processedFiles.filter(f => f.success).map((file, index) => (
                  <motion.div
                    key={file.id || index}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                        <FileText className="w-5 h-5 text-slate-500" />
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">
                          {file.vendor_name || 'Unknown Vendor'}
                        </p>
                        <p className="text-xs text-slate-400">{file.file_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="font-semibold text-slate-800">
                          £{(file.total_amount || 0).toFixed(2)}
                        </p>
                        <p className="text-xs text-slate-400">
                          VAT: £{(file.vat_amount || 0).toFixed(2)}
                        </p>
                      </div>
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                        file.confidence_score >= 80 ? 'bg-green-100 text-green-700' :
                        file.confidence_score >= 50 ? 'bg-amber-100 text-amber-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {file.confidence_score}%
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}