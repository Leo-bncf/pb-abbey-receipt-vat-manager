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

  const detectMultipleReceipts = async (fileUrl) => {
    const detectionPrompt = `Analyze this image/document carefully. Does it contain MULTIPLE separate receipts on the same page/image?
    
    Look for:
    - Multiple store names/logos
    - Multiple transaction dates
    - Multiple "TOTAL" amounts
    - Multiple receipt headers/footers
    - Receipts positioned in different areas of the page
    
    If there are multiple receipts, describe the location of each one (e.g., "top-left", "top-right", "bottom-left", "bottom-right", "center").`;
    
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: detectionPrompt,
      file_urls: [fileUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          has_multiple_receipts: { type: 'boolean' },
          receipt_count: { type: 'number' },
          receipt_locations: { 
            type: 'array', 
            items: { type: 'string' },
            description: 'Location description for each receipt'
          }
        }
      }
    });
    
    return result;
  };

  const processReceipt = async (fileUrl, fileName, fileType, batchId) => {
    // Fetch ALL learned rules and corrections
    const feedbackData = await base44.entities.AIFeedback.list('-created_date', 100);
    const correctionsData = await base44.entities.ReceiptCorrection.list('-created_date', 200);

    // Build comprehensive learning context
    let learningContext = '\n\n========================================\n';
    learningContext += 'CRITICAL: LEARNED PATTERNS FROM ADMIN TRAINING\n';
    learningContext += '========================================\n';

    if (feedbackData.length > 0) {
      learningContext += '\nAPPLY THESE LEARNED RULES:\n';
      feedbackData.forEach(f => {
        if (f.rule_learned) {
          learningContext += `✓ ${f.rule_learned}\n`;
        }
      });
    }

    if (correctionsData.length > 0) {
      learningContext += '\n\nCOMMON MISTAKES TO AVOID (from admin corrections):\n';

      // Group corrections by field to identify patterns
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

      // Analyze patterns for each field
      Object.entries(correctionsByField).forEach(([field, corrections]) => {
        learningContext += `\n${field.toUpperCase()}:\n`;

        // Show specific corrections
        const uniqueCorrections = corrections.slice(0, 10);
        uniqueCorrections.forEach(c => {
          learningContext += `  ✗ WRONG: "${c.from}"\n`;
          learningContext += `  ✓ CORRECT: "${c.to}"\n`;
          if (c.reason) learningContext += `    Reason: ${c.reason}\n`;
        });

        // Identify patterns
        if (corrections.length >= 3) {
          const pattern = identifyPattern(corrections, field);
          if (pattern) {
            learningContext += `  ⚠️ PATTERN: ${pattern}\n`;
          }
        }
      });
    }

    if (feedbackData.length === 0 && correctionsData.length === 0) {
      learningContext += '\n(No training data yet - extract as accurately as possible)\n';
    }

    learningContext += '\n========================================\n\n';

    // Helper function to identify patterns
    function identifyPattern(corrections, field) {
      if (field === 'vendor_name') {
        // Check for common vendor name issues
        const hasSpellingIssues = corrections.some(c => 
          c.from?.toLowerCase() !== c.to?.toLowerCase() && 
          c.from?.length === c.to?.length
        );
        if (hasSpellingIssues) return 'Pay extra attention to vendor name spelling';

        const hasCaseIssues = corrections.some(c => 
          c.from?.toLowerCase() === c.to?.toLowerCase()
        );
        if (hasCaseIssues) return 'Use proper capitalization for vendor names';
      }

      if (field === 'vat_amount' || field === 'total_amount') {
        const hasDecimalIssues = corrections.some(c => 
          Math.abs(parseFloat(c.from) - parseFloat(c.to)) < 0.1
        );
        if (hasDecimalIssues) return 'Double-check decimal point placement in amounts';
      }

      if (field === 'country') {
        return 'Infer country from currency, VAT format, and language on receipt';
      }

      return null;
    }
    
    // Use AI to extract data from the receipt
    const extractionPrompt = `CRITICAL INSTRUCTIONS - READ CAREFULLY:

    You have been trained by admin corrections and feedback. Apply ALL learned patterns below.

    ${learningContext}

    EXTRACTION TASK:
    This image may contain MULTIPLE separate receipts. Extract data from ALL receipts visible, creating one entry per physical receipt.
    Read with MAXIMUM ACCURACY and extract these fields for EACH receipt:

    REQUIRED FIELDS:
    - vendor_name: Exact business name as shown (read carefully, check spelling)
    - receipt_date: Date in YYYY-MM-DD format (read the actual date printed)
    - country: Country of purchase (infer from address, currency, VAT number format, language)
    - currency: Currency code (GBP, EUR, USD, etc.) - check the symbol on amounts
    - total_amount: Final total paid (number only, be precise)

    VAT FIELDS:
    - vat_amount: VAT/tax amount if explicitly shown (number only)
    - vat_rate: VAT rate percentage if shown (e.g., 20 for 20%)
    - vat_explicit: true ONLY if VAT/Tax line is printed on receipt
    - is_tax_free: true if receipt says "No Tax", "Tax Free", "Tax Exempt"

    TEXT & NOTES:
    - ocr_text: Complete text from receipt (preserve formatting, read everything)
    - extraction_notes: Document any issues, calculations, or ambiguities
    - confidence_score: Your confidence 0-100 in the accuracy of extracted data
    - receipt_location: Where in image this receipt is located (e.g., "top-left", "center", "page 6")

    UK VAT DECISION LOGIC (CRITICAL - FOLLOW EXACTLY):

    STEP 1: Check if supplier is VAT-registered (look for VAT number on receipt)
    - If NO VAT number found → vat_rate = 0, vat_amount = 0, extraction_notes += "No VAT number - supplier not VAT-registered"
    - If YES → Continue to STEP 2

    STEP 2: Determine VAT category based on items/services:

    CATEGORY A — VAT-EXEMPT (NO VAT):
    - Medical/dental care, NHS, education, insurance, banking, loans, residential rent, council tax, postage stamps
    → vat_rate = 0, vat_amount = 0, extraction_notes += "VAT-exempt items"

    CATEGORY B — ZERO-RATED (0% VAT but reclaimable):
    - Basic food (not hot takeaway/alcohol), children's clothing, books, newspapers, water supply, public transport
    → vat_rate = 0, vat_amount = 0, extraction_notes += "Zero-rated items"

    CATEGORY C — REDUCED-RATED (5% VAT):
    - Domestic fuel/power (gas, electricity), energy-saving materials
    → vat_rate = 5, VAT = Total × (5/105)

    CATEGORY D — STANDARD-RATED (20% VAT):
    - Restaurant meals, hot takeaways, alcohol, adult clothing, electronics, fuel (petrol/diesel), hotels, professional services
    → vat_rate = 20, VAT = Total × (20/120)

    DEFAULT: If category unclear → assume STANDARD-RATED (20%)

    OTHER COUNTRIES VAT CALCULATION:
    - Germany: 19% → VAT = Total × (19/119)
    - France: 20% → VAT = Total × (20/120)
    - Netherlands: 21% → VAT = Total × (21/121)
    - Spain: 21% → VAT = Total × (21/121)
    - Italy: 22% → VAT = Total × (22/122)

    ${learningContext}

    MULTI-RECEIPT DETECTION:
    Look for indicators of multiple receipts:
    - Multiple store names/logos
    - Multiple dates
    - Multiple "TOTAL" or "AMOUNT" lines
    - Different receipt numbers
    - Receipts in different positions on the page

    If you find multiple receipts, return an array with one object per receipt. 
    For receipt_location, specify:
    - For images: position like "top-left", "bottom-right", "center"
    - For PDFs: the page number like "page 1", "page 2", etc.
    Be as specific as possible to help locate the exact receipt.

    ACCURACY REQUIREMENTS (CRITICAL):
    - Read numbers precisely - double-check all amounts against the receipt
    - Verify vendor name spelling EXACTLY as printed (check character by character)
    - Ensure date is correct format YYYY-MM-DD
    - Apply ALL learned patterns and corrections from the training context above
    - If similar to a previous correction, use the corrected approach
    - When uncertain, default to the most common pattern from training data
    - Double-check your extraction against the training rules before returning`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      file_urls: [fileUrl],
      response_json_schema: {
        type: 'object',
        properties: {
          receipts: {
            type: 'array',
            items: {
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
                confidence_score: { type: 'number', description: 'Your confidence in the extraction 0-100' },
                receipt_location: { type: 'string', description: 'Where this receipt is located in the image' }
              }
            }
          }
        }
      }
    });

    // Process each receipt found in the image
    const receiptsData = [];
    const extractedReceipts = result.receipts || [];
    
    for (let i = 0; i < extractedReceipts.length; i++) {
      const receipt = extractedReceipts[i];
      
      // Calculate VAT if not explicit and not tax-free
      let vatAmount = receipt.vat_amount;
      let vatRate = receipt.vat_rate;
      
      // For EUR receipts, always set VAT to 0 (company policy: only track full amount)
      if (receipt.currency === 'EUR') {
        vatAmount = 0;
        vatRate = 0;
      } else if (!receipt.vat_explicit && !receipt.is_tax_free && receipt.total_amount && receipt.vat_rate) {
        vatAmount = receipt.total_amount - (receipt.total_amount / (1 + receipt.vat_rate / 100));
        vatAmount = Math.round(vatAmount * 100) / 100;
      }

      // Determine if needs review
      const needsReview = (receipt.confidence_score || 0) < 70 || 
                          !receipt.vendor_name || 
                          !receipt.total_amount;

      const receiptSuffix = extractedReceipts.length > 1 ? ` [${i + 1}/${extractedReceipts.length}]` : '';
      
      receiptsData.push({
        file_url: fileUrl,
        file_name: fileName + receiptSuffix,
        file_type: fileType,
        status: 'extracted',
        ocr_text: receipt.ocr_text || '',
        vendor_name: receipt.vendor_name || '',
        receipt_date: receipt.receipt_date || '',
        country: receipt.country || '',
        currency: receipt.currency || 'GBP',
        total_amount: receipt.total_amount || 0,
        vat_amount: vatAmount || 0,
        vat_rate: vatRate || 0,
        vat_explicit: receipt.vat_explicit || false,
        is_tax_free: receipt.is_tax_free || false,
        confidence_score: receipt.confidence_score || 50,
        needs_review: needsReview,
        is_reviewed: false,
        upload_batch: batchId,
        extraction_notes: (receipt.extraction_notes || '') + 
          (receipt.receipt_location ? ` [Location: ${receipt.receipt_location}]` : '') +
          (extractedReceipts.length > 1 ? ` [Part ${i + 1} of ${extractedReceipts.length} receipts from same image]` : '')
      });
    }
    
    return receiptsData;
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
        
        // Process with AI (may return multiple receipts from one image)
        const receiptsData = await processReceipt(file_url, file.name, getFileType(file), batchId);
        
        // Save each receipt to database
        for (const receiptData of receiptsData) {
          const savedReceipt = await base44.entities.Receipt.create(receiptData);
          results.push({ ...savedReceipt, success: true });
        }
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
                Successfully processed {processedFiles.filter(f => f.success).length} receipt{processedFiles.filter(f => f.success).length !== 1 ? 's' : ''}
                {errors.length > 0 ? ` (${errors.length} failed)` : ''}
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