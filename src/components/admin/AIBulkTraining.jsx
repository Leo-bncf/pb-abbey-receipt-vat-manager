import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Loader2, CheckCircle, ThumbsUp, ThumbsDown, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { base44 } from '@/api/base44Client';

export default function AIBulkTraining() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedReceipts, setExtractedReceipts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState({});
  const [fieldCorrections, setFieldCorrections] = useState({});
  const [incorrectFields, setIncorrectFields] = useState({});
  const [originalValues, setOriginalValues] = useState({});
  const [customRule, setCustomRule] = useState('');

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setExtractedReceipts([]);
      setCurrentIndex(0);
      setFeedback({});
      setFieldCorrections({});
      setIncorrectFields({});
      setOriginalValues({});
      setCustomRule('');
    }
  };

  const processFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      // Extract receipts using AI with learned patterns
      const feedbackData = await base44.entities.AIFeedback.list('-created_date', 50);
      const correctionsData = await base44.entities.ReceiptCorrection.list('-created_date', 100);
      
      // Build learning context
      let learningContext = '';
      if (feedbackData.length > 0 || correctionsData.length > 0) {
        learningContext = '\n\nLEARNED PATTERNS (apply these):\n';
        feedbackData.forEach(f => {
          if (f.rule_learned) learningContext += `✓ ${f.rule_learned}\n`;
        });
        if (correctionsData.length > 0) {
          learningContext += '\nCOMMON CORRECTIONS:\n';
          correctionsData.slice(0, 10).forEach(c => {
            learningContext += `• ${c.field_name}: "${c.original_value}" → "${c.corrected_value}"\n`;
          });
        }
      }

      const extractionPrompt = `CRITICAL: This image/PDF contains MULTIPLE separate receipts. Extract data from ALL receipts visible.
${learningContext}

EXTRACTION TASK:
Read this ${file.type === 'application/pdf' ? 'PDF document' : 'image'} with MAXIMUM ACCURACY and extract these fields for EACH receipt:

REQUIRED FIELDS:
- vendor_name: Exact business name as shown (check spelling character-by-character)
- receipt_date: Date in YYYY-MM-DD format
- country: Country of purchase (infer from address, VAT format, language, currency)
- currency: Currency code (GBP, EUR, USD, etc.)
- total_amount: Final total paid (number only)
- vat_amount: VAT/tax amount (calculate if not shown, based on rules below)
- vat_rate: VAT rate percentage (determine from country and item type)
- receipt_location: Where in image/PDF this receipt is located (e.g., "page 1 top-left", "page 2 center")

🛒 ASDA-SPECIFIC RULES (CHECK FIRST!):
IF vendor = "ASDA" (or variants):
- Normalize to "ASDA", country = "United Kingdom"
- ⚠️ ASDA has MIXED VAT (0% + 20%) in same receipt!
- Look for "VAT @ 20.00%", "VAT @ 0.00%", "Rate 20%", "Rate 0%"
- Extract BOTH VAT amounts, sum them
- extraction_notes = "ASDA mixed VAT: 0%: £X, 20%: £Y"
- Items: 0% = food staples | 20% = chocolate, sweets, drinks, alcohol, non-food
- Validation: VAT should be < 25% of total
- Never assume single rate for ASDA!

GENERAL UK VAT:
1. Check for explicit VAT lines first → use exact amounts
2. No VAT number → vat_rate=0
3. Categories: Exempt (0%), Zero-rated (0%), Reduced (5%), Standard (20%)
4. Calculate: Standard 20% = Total × (20/120)

OTHER COUNTRIES:
- Germany: 19% → VAT = Total × (19/119)
- France: 20% → VAT = Total × (20/120)
- Netherlands: 21% → VAT = Total × (21/121)
- Spain: 21% → VAT = Total × (21/121)
- Italy: 22% → VAT = Total × (22/122)

MULTI-RECEIPT DETECTION:
Look for multiple store names, dates, totals, receipt numbers, or different positions.

Return an array with one object per receipt found. Apply learned patterns. Double-check all extractions.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: extractionPrompt,
        file_urls: [file_url],
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
                  receipt_location: { type: 'string' }
                }
              }
            }
          }
        }
      });

      const receipts = result.receipts.map((r, i) => ({
        ...r,
        id: `temp_${i}`,
        file_url,
        file_name: file.name
      }));
      setExtractedReceipts(receipts);
      
      // Store original values
      const originals = {};
      receipts.forEach((r, i) => {
        originals[i] = { ...r };
      });
      setOriginalValues(originals);
    } catch (error) {
      console.error('Failed to process file:', error);
      alert('Failed to process file. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFieldChange = (field, value) => {
    setExtractedReceipts(prev => {
      const updated = [...prev];
      updated[currentIndex] = { ...updated[currentIndex], [field]: value };
      return updated;
    });
    
    // Track that this field was corrected
    if (originalValues[currentIndex] && originalValues[currentIndex][field] !== value) {
      setFieldCorrections(prev => ({
        ...prev,
        [currentIndex]: {
          ...(prev[currentIndex] || {}),
          [field]: {
            original: originalValues[currentIndex][field],
            corrected: value
          }
        }
      }));
    }
  };

  const toggleIncorrectField = (field) => {
    setIncorrectFields(prev => ({
      ...prev,
      [currentIndex]: {
        ...(prev[currentIndex] || {}),
        [field]: !(prev[currentIndex]?.[field])
      }
    }));
  };

  const markAsCorrect = () => {
    setFeedback(prev => ({ ...prev, [currentIndex]: 'correct' }));
    if (currentIndex < extractedReceipts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const markAsIncorrect = () => {
    setFeedback(prev => ({ ...prev, [currentIndex]: 'incorrect' }));
    // Initialize incorrect fields for this receipt if not already
    if (!incorrectFields[currentIndex]) {
      setIncorrectFields(prev => ({ ...prev, [currentIndex]: {} }));
    }
  };

  const saveCurrentCorrections = () => {
    setFeedback(prev => ({ ...prev, [currentIndex]: 'incorrect' }));
    if (currentIndex < extractedReceipts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const saveTraining = async () => {
    const user = await base44.auth.me();
    
    // Save field-level corrections to ReceiptCorrection entity
    for (const [index, corrections] of Object.entries(fieldCorrections)) {
      const receipt = extractedReceipts[index];
      for (const [fieldName, correction] of Object.entries(corrections)) {
        await base44.entities.ReceiptCorrection.create({
          receipt_id: receipt.id,
          field_name: fieldName,
          original_value: String(correction.original || ''),
          corrected_value: String(correction.corrected || ''),
          correction_reason: `Bulk training correction for ${receipt.vendor_name}`,
          corrected_by: user.email
        });
      }
    }

    // Build AI feedback entries with detailed rules
    const feedbackEntries = [];
    
    extractedReceipts.forEach((receipt, index) => {
      if (feedback[index] === 'incorrect') {
        const corrections = fieldCorrections[index] || {};
        const incorrects = incorrectFields[index] || {};
        
        // Generate specific rules from field corrections
        const rules = [];
        Object.entries(corrections).forEach(([field, correction]) => {
          if (incorrects[field]) {
            if (field === 'vendor_name') {
              rules.push(`Vendor name should be "${correction.corrected}" not "${correction.original}"`);
            } else if (field === 'vat_amount' || field === 'total_amount') {
              rules.push(`For ${receipt.vendor_name}: ${field.replace('_', ' ')} should be ${correction.corrected} not ${correction.original}`);
            } else if (field === 'country') {
              rules.push(`${receipt.vendor_name} is located in ${correction.corrected}`);
            } else {
              rules.push(`${field.replace('_', ' ')}: "${correction.original}" → "${correction.corrected}"`);
            }
          }
        });

        const correctedFields = Object.keys(corrections).filter(f => incorrects[f]).join(', ');
        
        feedbackEntries.push({
          feedback_type: 'correction',
          user_message: `Corrected ${correctedFields || 'fields'} for ${receipt.vendor_name}`,
          rule_learned: rules.length > 0 ? rules.join('; ') : `Review extractions for ${receipt.vendor_name}`,
          is_applied: true,
          submitted_by: user.email
        });
        
      } else if (feedback[index] === 'correct') {
        feedbackEntries.push({
          feedback_type: 'confirmation',
          user_message: `Confirmed correct: ${receipt.vendor_name}, ${receipt.total_amount} ${receipt.currency}`,
          rule_learned: `Correctly identified: "${receipt.vendor_name}" with total ${receipt.total_amount} ${receipt.currency}, VAT ${receipt.vat_amount}`,
          is_applied: true,
          submitted_by: user.email
        });
      }
    });

    // Add custom rule if provided
    if (customRule.trim()) {
      feedbackEntries.push({
        feedback_type: 'rule',
        user_message: `Custom rule from bulk training: ${customRule}`,
        rule_learned: customRule.trim(),
        is_applied: true,
        submitted_by: user.email
      });
    }

    // Save all feedback
    for (const entry of feedbackEntries) {
      await base44.entities.AIFeedback.create(entry);
    }

    const totalCorrections = Object.keys(fieldCorrections).length;
    const totalFeedback = Object.keys(feedback).length;
    alert(`Training saved! ${totalCorrections} field corrections and ${totalFeedback} receipts reviewed. AI will learn from this data.`);
    
    // Reset
    setFile(null);
    setExtractedReceipts([]);
    setCurrentIndex(0);
    setFeedback({});
    setFieldCorrections({});
    setIncorrectFields({});
    setOriginalValues({});
    setCustomRule('');
  };

  const currentReceipt = extractedReceipts[currentIndex];
  const currentFeedback = feedback[currentIndex];
  const currentIncorrectFields = incorrectFields[currentIndex] || {};
  const currentCorrections = fieldCorrections[currentIndex] || {};
  
  const receiptFields = [
    { key: 'vendor_name', label: 'Vendor Name', type: 'text' },
    { key: 'receipt_date', label: 'Date', type: 'date' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'currency', label: 'Currency', type: 'text' },
    { key: 'total_amount', label: 'Total Amount', type: 'number' },
    { key: 'vat_amount', label: 'VAT Amount', type: 'number' },
    { key: 'vat_rate', label: 'VAT Rate (%)', type: 'number' }
  ];

  if (!file) {
    return (
      <div className="h-full bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            AI Bulk Training
          </h3>
          <p className="text-sm text-slate-500">Upload images with multiple receipts to train the AI</p>
        </div>
        
        <div className="p-12 flex flex-col items-center justify-center">
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="w-full max-w-md">
              <div className="border-2 border-dashed border-slate-300 rounded-2xl p-12 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all text-center">
                <div className="w-16 h-16 rounded-2xl bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                  <Upload className="w-8 h-8 text-indigo-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-800 mb-2">
                  Upload Receipt Image
                </h3>
                <p className="text-sm text-slate-500">
                  PDF or image file with one or more receipts
                </p>
              </div>
            </div>
          </label>
        </div>
      </div>
    );
  }

  if (isProcessing) {
    return (
      <div className="h-full bg-white rounded-2xl border border-slate-200 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Processing...</h3>
          <p className="text-slate-500">Extracting receipts with AI</p>
        </div>
      </div>
    );
  }

  if (extractedReceipts.length === 0) {
    return (
      <div className="h-full bg-white rounded-2xl border border-slate-200">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">{file.name}</h3>
            <p className="text-sm text-slate-500">Ready to process</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setFile(null)}>Cancel</Button>
            <Button onClick={processFile} className="bg-indigo-600 hover:bg-indigo-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Extract Receipts
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-slate-800">{file.name}</h3>
          <Badge className="bg-indigo-100 text-indigo-700">
            Receipt {currentIndex + 1} of {extractedReceipts.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {extractedReceipts.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors ${
                index === currentIndex 
                  ? 'bg-indigo-600 text-white' 
                  : feedback[index] === 'correct'
                  ? 'bg-green-100 text-green-700'
                  : feedback[index] === 'incorrect'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {feedback[index] === 'correct' ? <CheckCircle className="w-4 h-4" /> : 
               feedback[index] === 'incorrect' ? '!' : 
               index + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-4"
          >
            {/* Location info */}
            {currentReceipt.receipt_location && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-800">
                  <strong>Location:</strong> {currentReceipt.receipt_location}
                </p>
              </div>
            )}

            {/* Extracted fields with checkboxes */}
            <div className="space-y-3">
              {receiptFields.map(field => (
                <div key={field.key} className={`p-3 rounded-lg border transition-all ${
                  currentIncorrectFields[field.key] 
                    ? 'bg-amber-50 border-amber-300' 
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <div className="flex items-start gap-3">
                    {currentFeedback === 'incorrect' && (
                      <Checkbox
                        checked={currentIncorrectFields[field.key] || false}
                        onCheckedChange={() => toggleIncorrectField(field.key)}
                        className="mt-1"
                      />
                    )}
                    <div className="flex-1">
                      <label className="text-sm font-medium text-slate-700 block mb-1">
                        {field.label}
                        {currentIncorrectFields[field.key] && (
                          <span className="ml-2 text-xs text-amber-600">(marked incorrect)</span>
                        )}
                      </label>
                      <Input
                        type={field.type}
                        step={field.type === 'number' ? '0.01' : undefined}
                        value={currentReceipt[field.key] || ''}
                        onChange={(e) => handleFieldChange(
                          field.key, 
                          field.type === 'number' ? parseFloat(e.target.value) : e.target.value
                        )}
                        className={currentIncorrectFields[field.key] ? 'border-amber-400' : ''}
                        disabled={currentFeedback !== 'incorrect'}
                      />
                      {currentCorrections[field.key] && (
                        <p className="text-xs text-slate-500 mt-1">
                          Original: {currentCorrections[field.key].original}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Custom learning rule */}
            {currentFeedback === 'incorrect' && (
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                <label className="text-sm font-medium text-indigo-800 block mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Add Custom Learning Rule (Optional)
                </label>
                <Textarea
                  placeholder="E.g., 'For ASDA receipts, always check for mixed VAT rates' or 'Vendor X always has 20% VAT'"
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value)}
                  className="bg-white"
                  rows={3}
                />
                <p className="text-xs text-indigo-600 mt-2">
                  This rule will be added to the AI's learning database and applied to future extractions.
                </p>
              </div>
            )}

            {/* Feedback buttons */}
            <div className="space-y-3 pt-4">
              {!currentFeedback && (
                <div className="flex gap-3">
                  <Button
                    onClick={markAsCorrect}
                    className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                  >
                    <ThumbsUp className="w-4 h-4" />
                    Correct
                  </Button>
                  <Button
                    onClick={markAsIncorrect}
                    variant="outline"
                    className="flex-1 border-amber-400 text-amber-700 hover:bg-amber-50 gap-2"
                  >
                    <ThumbsDown className="w-4 h-4" />
                    Mark Incorrect Fields
                  </Button>
                </div>
              )}
              
              {currentFeedback === 'incorrect' && (
                <>
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2">
                    <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-blue-800">
                      <p className="font-medium mb-1">Check incorrect fields, correct the values, and optionally add a learning rule.</p>
                      <p className="text-blue-700">Selected fields: {Object.values(currentIncorrectFields).filter(Boolean).length}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      onClick={saveCurrentCorrections}
                      className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                      disabled={Object.values(currentIncorrectFields).filter(Boolean).length === 0}
                    >
                      <CheckCircle className="w-4 h-4" />
                      Save & Continue
                    </Button>
                    <Button
                      onClick={() => {
                        setFeedback(prev => {
                          const updated = { ...prev };
                          delete updated[currentIndex];
                          return updated;
                        });
                        setIncorrectFields(prev => {
                          const updated = { ...prev };
                          delete updated[currentIndex];
                          return updated;
                        });
                      }}
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              )}
              
              {currentFeedback === 'correct' && (
                <p className="text-sm text-green-600 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Marked as correct
                </p>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between bg-slate-50">
        <div className="text-sm text-slate-600">
          {Object.keys(feedback).length} of {extractedReceipts.length} reviewed
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setFile(null)}>
            Cancel
          </Button>
          <Button
            onClick={saveTraining}
            disabled={Object.keys(feedback).length === 0}
            className="bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Save Training
          </Button>
        </div>
      </div>
    </div>
  );
}