import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { FileText, ArrowRight, CheckCircle, Loader2, AlertCircle, Clock, Download, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Folder } from 'lucide-react';
import { format } from 'date-fns';
import UploadZone from '../components/upload/UploadZone';
import { createPageUrl } from '@/utils';

// A single source PDF/image becomes several receipts named "doc.pdf [2/5]".
// Strip that suffix to recover the original document name.
const baseDocName = (fileName) => (fileName || '').replace(/\s*\[\d+\/\d+\]\s*$/, '').trim();

// Pull the expected date window from an expense file name, e.g.
// "…_PB Abbey_August-September 2026.pdf" -> "August-September 2026". Used to
// pin the year so the OCR model doesn't mis-read faint dates into wrong years.
const periodFromName = (fileName) => {
  const m = (fileName || '').match(/([A-Za-z]+(?:-[A-Za-z]+)?\s+\d{4})\s*(?:\[[^\]]*\])?\.?[a-z0-9]*$/i);
  return m ? m[1].trim() : '';
};

// Cloudflare Worker that runs Mistral OCR + structuring with our own key
// (base44 no longer in the AI path). Falls back to base44 InvokeLLM if down.
const MISTRAL_WORKER_URL = 'https://pb-abbey-mistral.leo-bncf.workers.dev';

// True for base44's monthly AI/integration credit limit (HTTP 402). Retrying
// or continuing the batch is pointless — the account is out of credits.
const isCreditLimitError = (e) => {
  const msg = (e?.message || '') + JSON.stringify(e?.response?.data || '');
  return e?.response?.status === 402 || /limit of integrations|integration_credits/i.test(msg);
};

// Retry a flaky async op (upload / AI extraction) with linear backoff so a
// single network blip doesn't abort a whole receipt in a long batch. Client
// errors (4xx) like the credit limit are permanent, so don't retry them.
const withRetry = async (fn, attempts = 3) => {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.response?.status;
      if (isCreditLimitError(e) || (status >= 400 && status < 500)) throw e;
      if (i < attempts - 1) await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
    }
  }
  throw lastErr;
};

export default function Upload() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [processedFiles, setProcessedFiles] = useState([]);
  const [errors, setErrors] = useState([]);
  const [skipped, setSkipped] = useState([]);
  const [limitReached, setLimitReached] = useState(false);
  const [rescanningDoc, setRescanningDoc] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => base44.entities.Folder.list('name'),
  });

  const { data: existingReceipts = [] } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  // History of documents already uploaded, grouped by original file name.
  const uploadHistory = useMemo(() => {
    const byDoc = {};
    existingReceipts.forEach(r => {
      const name = baseDocName(r.file_name);
      if (!name) return;
      if (!byDoc[name]) byDoc[name] = { name, count: 0, date: r.created_date, file_url: r.file_url, file_type: r.file_type, folder_id: r.folder_id };
      byDoc[name].count += 1;
      // Keep the most recent upload's file + date (all parts share one source file).
      if (new Date(r.created_date) > new Date(byDoc[name].date)) {
        byDoc[name].date = r.created_date;
        byDoc[name].file_url = r.file_url;
        byDoc[name].file_type = r.file_type;
        byDoc[name].folder_id = r.folder_id;
      }
    });
    return Object.values(byDoc).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [existingReceipts]);

  const uploadedDocNames = useMemo(
    () => new Set(uploadHistory.map(d => d.name.toLowerCase())),
    [uploadHistory]
  );

  const getFileType = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return ext;
  };

  const processReceipt = async (fileUrl, fileName, fileType, batchId, feedbackData, correctionsData) => {

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

    VAT FIELDS (CRITICAL - READ CAREFULLY):
    - vat_explicit: true if receipt shows "VAT", "Tax", "TVA" line with amount (CHECK FIRST!)
    - vat_amount: If vat_explicit=true, extract the exact VAT amount shown on receipt
    - vat_rate: If vat_explicit=true, extract or calculate the rate from receipt
    - is_tax_free: true if receipt says "No Tax", "Tax Free", "Tax Exempt"
    
    IMPORTANT: If receipt explicitly shows VAT (e.g., "VAT @ 20%: £2.50"), set vat_explicit=true and use that exact amount!

    TEXT & NOTES:
    - ocr_text: Complete text from receipt (preserve formatting, read everything)
    - extraction_notes: Document any issues, calculations, or ambiguities
    - confidence_score: Your confidence 0-100 in the accuracy of extracted data
    - receipt_location: Where in image this receipt is located (e.g., "top-left", "center", "page 6")

    ═══════════════════════════════════════════════════════════
    🛒 ASDA-SPECIFIC VAT RULES (HIGHEST PRIORITY - CHECK FIRST!)
    ═══════════════════════════════════════════════════════════
    
    IF vendor contains "ASDA", "ASDA STORES", "ASDA SUPERSTORE", "ASDA SUPER CENTRE":
    → Normalize vendor_name to "ASDA"
    → Set country to "United Kingdom"
    → ⚠️ CRITICAL: ASDA receipts contain MIXED VAT RATES (0% + 20%) in same receipt!
    
    ASDA RULE 1 - Explicit VAT Breakdown (HIGHEST PRIORITY):
    Look for VAT lines on receipt:
    - "VAT @ 20.00%: £X.XX"
    - "VAT @ 0.00%: £0.00"
    - "Rate 20%: £X.XX"
    - "Rate 0%: £0.00"
    
    If found:
    → Extract EACH VAT amount separately
    → Sum all VAT amounts: vat_amount = VAT_0% + VAT_20%
    → Set vat_explicit = true
    → Calculate weighted average: vat_rate = (vat_amount / (total_amount - vat_amount)) × 100
    → extraction_notes = "ASDA mixed VAT: 0%: £X.XX, 20%: £Y.YY, Total VAT: £Z.ZZ"
    → confidence_score = 95
    
    ASDA RULE 2 - Item-Level Classification (if VAT not explicit):
    Scan items on receipt:
    • 0% ZERO-RATED: bread, milk, cheese, eggs, fruit, vegetables, meat, fish, rice, pasta, flour, baby food, fresh/frozen food
    • 20% STANDARD: chocolate, sweets, confectionery, ice cream, soft drinks, alcohol, tobacco, cleaning products, electronics, clothing, toiletries, home goods
    
    For each item:
    → Classify as 0% or 20%
    → Calculate VAT per item
    → Sum by rate
    → vat_amount = total of all VAT
    → extraction_notes = "ASDA item-level VAT: 0% items: £X.XX, 20% items: £Y.YY"
    → confidence_score = 75
    
    ASDA RULE 3 - Validation:
    → If VAT > 25% of Total → FLAG ERROR, needs_review = true
    → If VAT > Total → FLAG ERROR
    → If VAT < 0 → FLAG ERROR
    
    ASDA RULE 4 - Never assume single rate:
    → NEVER apply single 0% or 20% to entire receipt
    → ALWAYS expect mixed VAT for ASDA
    
    ═══════════════════════════════════════════════════════════
    
    GENERAL UK VAT LOGIC (for non-ASDA receipts):

    STEP 1: CHECK IF VAT IS PRINTED ON RECEIPT
    - Look for "VAT", "Tax", "VAT @ 20%" lines
    - If shown → USE EXACT AMOUNT, set vat_explicit=true

    STEP 2: Check for VAT registration number
    - NO VAT number → vat_rate=0, vat_amount=0

    STEP 3: Determine category (if VAT not explicit):
    A) VAT-EXEMPT (0%): Medical, education, insurance, banking, rent
    B) ZERO-RATED (0%): Basic groceries only
    C) REDUCED 5%: Domestic fuel/electricity
    D) STANDARD 20%: Restaurants, alcohol, prepared foods, non-food

    STEP 4: Calculate rate if only amount shown:
    vat_rate = (vat_amount / (total_amount - vat_amount)) × 100

    OTHER COUNTRIES VAT CALCULATION:
    - Germany: 19% → VAT = Total × (19/119)
    - France: 20% → VAT = Total × (20/120)
    - Netherlands: 21% → VAT = Total × (21/121)
    - Spain: 21% → VAT = Total × (21/121)
    - Italy: 22% → VAT = Total × (22/122)

    CRITICAL REMINDERS:
    - ALWAYS check if VAT is printed on the receipt FIRST before applying category logic
    - If receipt shows VAT amount, use it exactly - don't recalculate
    - Supermarkets CAN have 20% VAT (alcohol, prepared foods, non-food items)
    - Read the receipt text carefully for VAT lines

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

    // Primary scan path: our Mistral Cloudflare Worker (OCR every page →
    // structured JSON per page), which uses our own Mistral key and keeps base44
    // out of the AI path (no function-capability / credit limits). Falls back to
    // base44's InvokeLLM if the Worker is unreachable, so uploads never break.
    const responseSchema = {
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
    };

    let result;
    try {
      if (!MISTRAL_WORKER_URL) throw new Error('Mistral worker URL not configured');
      const resp = await fetch(MISTRAL_WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // period (parsed from the file name, e.g. "August-September 2026") pins
        // the year so faint dates aren't mis-read into the wrong year.
        body: JSON.stringify({ file_url: fileUrl, prompt: extractionPrompt, period: periodFromName(fileName) }),
      });
      if (!resp.ok) throw new Error(`Worker HTTP ${resp.status}`);
      const payload = await resp.json();
      if (!payload || payload.error || !Array.isArray(payload.receipts)) {
        throw new Error(payload?.error || 'Worker returned no receipts');
      }
      result = payload;
    } catch (workerErr) {
      console.warn('Mistral worker failed, falling back to base44 InvokeLLM:', workerErr?.message || workerErr);
      result = await base44.integrations.Core.InvokeLLM({
        prompt: extractionPrompt,
        file_urls: [fileUrl],
        response_json_schema: responseSchema,
      });
    }

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

      // Validate the extraction. Anything suspicious is flagged for admin
      // review, which produces a correction that feeds back into training.
      const issues = [];
      const totalNum = receipt.total_amount || 0;
      if ((receipt.confidence_score || 0) < 70) issues.push('low confidence');
      if (!receipt.vendor_name) issues.push('missing vendor');
      if (!receipt.total_amount) issues.push('missing total');
      if (!receipt.receipt_date) issues.push('missing date');
      if (totalNum < 0) issues.push('negative total');
      if (vatAmount < 0) issues.push('negative VAT');
      if (totalNum > 0 && vatAmount > totalNum) issues.push('VAT exceeds total');
      // UK standard VAT is 20%; above ~25% of the total is almost always an error
      if (receipt.currency !== 'EUR' && totalNum > 0 && vatAmount > totalNum * 0.25) {
        issues.push('VAT over 25% of total');
      }
      const needsReview = issues.length > 0;

      const receiptSuffix = extractedReceipts.length > 1 ? ` [${i + 1}/${extractedReceipts.length}]` : '';
      
      receiptsData.push({
        file_url: fileUrl,
        file_name: fileName + receiptSuffix,
        file_type: fileType,
        folder_id: selectedFolderId || undefined,
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
          (extractedReceipts.length > 1 ? ` [Part ${i + 1} of ${extractedReceipts.length} receipts from same image]` : '') +
          (issues.length > 0 ? ` [Review needed: ${issues.join(', ')}]` : '')
      });
    }
    
    return receiptsData;
  };

  const handleFilesSelected = async (files) => {
    // Detect files whose document was already uploaded (the root cause of past
    // duplicate receipts). A document only counts as "already uploaded" if its
    // receipts currently exist, so deleting them and re-uploading still works.
    const filesArr = Array.from(files);
    const dupeFiles = filesArr.filter(f => uploadedDocNames.has(baseDocName(f.name).toLowerCase()));
    const filesToProcess = filesArr;

    // If duplicates are detected, warn the user and let them choose: continue
    // (upload them anyway) or stop. Continuing bypasses the duplicate guard.
    let forceUpload = false;
    if (dupeFiles.length > 0) {
      const list = dupeFiles.map(f => `• ${f.name}`).join('\n');
      const proceed = confirm(
        `⚠️ Duplicate detected\n\n` +
        `The following ${dupeFiles.length} file(s) have already been uploaded:\n\n${list}\n\n` +
        `Click OK to upload them anyway, or Cancel to stop.`
      );
      if (!proceed) return; // Stop
      forceUpload = true;   // Continue with upload (re-upload the duplicates)
    }

    // Only guard against an exact re-upload (same file_name). Content-based
    // dedup is intentionally left to Admin → Duplicates so real tickets that
    // happen to share vendor/date/amount are never dropped on upload.
    const existingFileNames = new Set(existingReceipts.map(r => r.file_name));
    const skippedDuplicates = [];

    setIsProcessing(true);
    setUploadProgress({ current: 0, total: filesToProcess.length });
    setProcessedFiles([]);
    setErrors([]);
    setSkipped([]);
    setLimitReached(false);
    setElapsedTime(0);

    const startTime = Date.now();
    const timerInterval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);

    const batchId = `batch_${Date.now()}`;
    const results = [];
    const errorList = [];

    // Load AI training data once per batch instead of re-fetching for every file
    let feedbackData = [];
    let correctionsData = [];
    try {
      feedbackData = await base44.entities.AIFeedback.list('-created_date', 100);
      correctionsData = await base44.entities.ReceiptCorrection.list('-created_date', 200);
    } catch (e) {
      console.error('Failed to load AI training data:', e);
    }

    for (let i = 0; i < filesToProcess.length; i++) {
      const file = filesToProcess[i];
      setUploadProgress({ current: i + 1, total: filesToProcess.length });

      try {
        // Upload + AI extraction retry transient failures (network/timeouts).
        // Re-creating receipts is safe: the duplicate guard below skips any
        // that already landed, so a retry never double-saves.
        const { file_url } = await withRetry(() => base44.integrations.Core.UploadFile({ file }));

        // Process with AI (may return multiple receipts from one image)
        const receiptsData = await withRetry(() =>
          processReceipt(file_url, file.name, getFileType(file), batchId, feedbackData, correctionsData)
        );

        // Save every extracted receipt. Only skip an EXACT re-upload (same
        // file_name = same document + same receipt slot). We deliberately do
        // NOT skip by content here: two genuine tickets can share vendor +
        // date + amount (e.g. two coffees), and dropping them silently loses
        // real receipts. Same-content duplicates from re-uploaded documents
        // are surfaced for review in Admin → Duplicates instead.
        for (const receiptData of receiptsData) {
          if (!forceUpload && existingFileNames.has(receiptData.file_name)) {
            skippedDuplicates.push({
              file_name: receiptData.file_name,
              vendor_name: receiptData.vendor_name,
              receipt_date: receiptData.receipt_date,
              total_amount: receiptData.total_amount,
            });
            continue;
          }
          const savedReceipt = await base44.entities.Receipt.create(receiptData);
          existingFileNames.add(receiptData.file_name);
          results.push({ ...savedReceipt, success: true });
        }
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        // base44 monthly AI credits exhausted — no point trying more files.
        if (isCreditLimitError(error)) {
          setLimitReached(true);
          errorList.push({ fileName: file.name, error: 'base44 AI usage limit reached for this month.' });
          break;
        }
        errorList.push({ fileName: file.name, error: error.message });
      }
    }

    clearInterval(timerInterval);
    setProcessedFiles(results);
    setErrors(errorList);
    setSkipped(skippedDuplicates);
    setIsProcessing(false);
    // Refresh the upload history so newly uploaded docs show up immediately.
    queryClient.invalidateQueries({ queryKey: ['receipts'] });
  };

  // Re-scan an already-uploaded document: re-run the AI on the original file,
  // then replace its old receipts. Use when the first scan missed some tickets.
  const rescanDocument = async (doc) => {
    const docReceipts = existingReceipts.filter(r => baseDocName(r.file_name) === doc.name);
    if (!doc.file_url || docReceipts.length === 0) {
      alert('Cannot rescan: the original file is not available.');
      return;
    }
    if (!confirm(
      `Rescan "${doc.name}"?\n\n` +
      `This re-reads the original file and REPLACES its current ${docReceipts.length} receipt(s). ` +
      `Use this if the scan missed some tickets.`
    )) return;

    setRescanningDoc(doc.name);
    try {
      let feedbackData = [];
      let correctionsData = [];
      try {
        feedbackData = await base44.entities.AIFeedback.list('-created_date', 100);
        correctionsData = await base44.entities.ReceiptCorrection.list('-created_date', 200);
      } catch (e) {
        console.error('Failed to load AI training data:', e);
      }

      const batchId = `rescan_${Date.now()}`;
      // Extract first; only delete the old receipts once the new scan succeeds.
      const newReceipts = await withRetry(() =>
        processReceipt(doc.file_url, doc.name, doc.file_type || 'pdf', batchId, feedbackData, correctionsData)
      );

      if (newReceipts.length === 0) {
        alert('Rescan found no receipts — keeping the existing ones.');
        return;
      }

      for (const r of docReceipts) await base44.entities.Receipt.delete(r.id);
      for (const rd of newReceipts) {
        await base44.entities.Receipt.create({ ...rd, folder_id: doc.folder_id || undefined });
      }

      queryClient.invalidateQueries({ queryKey: ['receipts'] });
      alert(`Rescanned "${doc.name}": ${docReceipts.length} → ${newReceipts.length} receipt(s).`);
    } catch (error) {
      console.error('Rescan failed:', error);
      alert(isCreditLimitError(error)
        ? 'Rescan failed: base44 AI usage limit reached for this month.'
        : `Rescan failed: ${error.message}`);
    } finally {
      setRescanningDoc(null);
    }
  };

  const totalVAT = processedFiles
    .filter(f => f.success)
    .reduce((sum, f) => sum + (f.vat_amount || 0), 0);

  const totalAmount = processedFiles
    .filter(f => f.success)
    .reduce((sum, f) => sum + (f.total_amount || 0), 0);

  const uploadHistorySection = uploadHistory.length > 0 && (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-white rounded-2xl border border-slate-200 overflow-hidden mt-8 text-left"
    >
      <div className="px-6 py-4 border-b border-slate-200 flex items-center gap-2">
        <Clock className="w-5 h-5 text-slate-400" />
        <h3 className="font-semibold text-slate-800">Previously Uploaded Documents</h3>
        <Badge variant="outline" className="ml-auto text-xs">{uploadHistory.length}</Badge>
      </div>
      <p className="px-6 pt-3 text-sm text-slate-500">
        Check here before uploading to avoid processing the same document twice.
      </p>
      <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto mt-2">
        {uploadHistory.map((doc) => (
          <div key={doc.name} className="px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <FileText className="w-4 h-4 text-slate-400 shrink-0" />
              <span className="text-sm text-slate-700 truncate" title={doc.name}>{doc.name}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-slate-400">
                {doc.date ? format(new Date(doc.date), 'd MMM yyyy') : ''}
              </span>
              <Badge variant="outline" className="text-xs">
                {doc.count} receipt{doc.count !== 1 ? 's' : ''}
              </Badge>
              {doc.file_url && (
                <a
                  href={doc.file_url}
                  download={doc.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Download original file"
                  className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 hover:underline"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              )}
              <button
                onClick={() => rescanDocument(doc)}
                disabled={!!rescanningDoc}
                title="Delete this document's receipts and scan it again"
                className="inline-flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 hover:underline disabled:opacity-40"
              >
                {rescanningDoc === doc.name ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                {rescanningDoc === doc.name ? 'Rescanning…' : 'Rescan'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* base44 AI credit limit reached */}
        {limitReached && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="text-sm text-red-800">
              <p className="font-semibold mb-1">AI usage limit reached</p>
              <p className="text-red-700">
                Your base44 plan has hit its monthly AI/integration limit, so receipts can’t be
                scanned right now. Upgrade your base44 plan or wait for the monthly reset, then try again.
              </p>
            </div>
          </div>
        )}

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
          <p className="text-slate-500 max-w-md mx-auto mb-6">
            Upload your receipts and our AI will automatically extract vendor details, amounts, and calculate VAT.
          </p>

          {/* Folder Selection */}
          {folders.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-xs mx-auto"
            >
              <label className="text-sm font-medium text-slate-700 block mb-2 flex items-center gap-2">
                <Folder className="w-4 h-4" />
                Save to Folder (optional)
              </label>
              <Select value={selectedFolderId || ''} onValueChange={(v) => setSelectedFolderId(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="No folder (root)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>No folder (root)</SelectItem>
                  {folders.map(folder => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </motion.div>
          )}
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
            {uploadHistorySection}
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
                {skipped.length > 0 ? ` (${skipped.length} duplicate${skipped.length !== 1 ? 's' : ''} skipped)` : ''}
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

              {skipped.length > 0 && (
                <div className="mb-6 p-4 bg-amber-50 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                    <span className="font-medium text-amber-800">
                      {skipped.length} duplicate receipt(s) skipped — already in the system
                    </span>
                  </div>
                  <ul className="text-sm text-amber-700 space-y-1">
                    {skipped.map((s, i) => (
                      <li key={i}>
                        {s.vendor_name || 'Unknown'} · {s.receipt_date || 'no date'} · £{(s.total_amount || 0).toFixed(2)}
                        <span className="text-amber-500"> ({s.file_name})</span>
                      </li>
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
                    setSkipped([]);
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

            {uploadHistorySection}
          </motion.div>
        )}
      </div>
    </div>
  );
}