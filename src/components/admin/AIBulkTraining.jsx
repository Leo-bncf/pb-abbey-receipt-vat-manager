import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Loader2, CheckCircle, XCircle, Image as ImageIcon, ThumbsUp, ThumbsDown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { base44 } from '@/api/base44Client';

export default function AIBulkTraining() {
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedReceipts, setExtractedReceipts] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [feedback, setFeedback] = useState({});

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setExtractedReceipts([]);
      setCurrentIndex(0);
      setFeedback({});
    }
  };

  const processFile = async () => {
    if (!file) return;

    setIsProcessing(true);
    try {
      // Upload file
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      // Extract receipts using AI
      const extractionPrompt = `CRITICAL: This image/PDF contains MULTIPLE separate receipts. Extract data from ALL receipts visible.

EXTRACTION TASK:
Read this ${file.type === 'application/pdf' ? 'PDF document' : 'image'} with MAXIMUM ACCURACY and extract these fields for EACH receipt:

REQUIRED FIELDS:
- vendor_name: Exact business name as shown
- receipt_date: Date in YYYY-MM-DD format
- country: Country of purchase
- currency: Currency code (GBP, EUR, USD, etc.)
- total_amount: Final total paid (number only)
- vat_amount: VAT/tax amount if shown (number only, 0 if not shown)
- vat_rate: VAT rate percentage if shown (e.g., 20 for 20%)
- receipt_location: Where in image/PDF this receipt is located (e.g., "page 1 top-left", "page 2 center")

MULTI-RECEIPT DETECTION:
Look for multiple:
- Store names/logos
- Dates
- Total amounts
- Receipt numbers
- Different positions on page

Return an array with one object per receipt found. Be precise with numbers and spelling.`;

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

      setExtractedReceipts(result.receipts.map((r, i) => ({
        ...r,
        id: `temp_${i}`,
        file_url,
        file_name: file.name
      })));
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
  };

  const markAsCorrect = () => {
    setFeedback(prev => ({ ...prev, [currentIndex]: 'correct' }));
    if (currentIndex < extractedReceipts.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const markAsIncorrect = () => {
    setFeedback(prev => ({ ...prev, [currentIndex]: 'incorrect' }));
  };

  const saveTraining = async () => {
    const user = await base44.auth.me();
    
    // Analyze corrections to create specific learning rules
    const learnings = [];
    const specificRules = [];

    extractedReceipts.forEach((receipt, index) => {
      if (feedback[index] === 'incorrect') {
        // User made corrections - identify specific patterns
        learnings.push({
          receipt_data: receipt,
          feedback_type: 'correction',
          user_message: `Corrected extraction for ${receipt.vendor_name}: Total=${receipt.total_amount} ${receipt.currency}, VAT=${receipt.vat_amount}`,
          corrected_by: user.email
        });
        
        // Create specific learning rules
        specificRules.push(
          `For vendor "${receipt.vendor_name}": total is ${receipt.total_amount} ${receipt.currency}, VAT is ${receipt.vat_amount} (${receipt.vat_rate}%)`
        );
        
        if (receipt.country) {
          specificRules.push(
            `Vendor "${receipt.vendor_name}" is located in ${receipt.country}`
          );
        }
      } else if (feedback[index] === 'correct') {
        learnings.push({
          receipt_data: receipt,
          feedback_type: 'confirmation',
          user_message: `Confirmed correct: ${receipt.vendor_name}, ${receipt.total_amount} ${receipt.currency}`,
          corrected_by: user.email
        });
        
        // Reinforce correct patterns
        specificRules.push(
          `Correctly identified: "${receipt.vendor_name}" with total ${receipt.total_amount} ${receipt.currency}`
        );
      }
    });

    // Save detailed feedback to AI learning system
    for (let i = 0; i < learnings.length; i++) {
      const learning = learnings[i];
      await base44.entities.AIFeedback.create({
        feedback_type: learning.feedback_type,
        user_message: learning.user_message,
        rule_learned: specificRules[i],
        is_applied: true,
        submitted_by: user.email
      });
    }

    alert(`Training saved! ${learnings.length} patterns will improve future extractions.`);
    
    // Reset
    setFile(null);
    setExtractedReceipts([]);
    setCurrentIndex(0);
    setFeedback({});
  };

  const currentReceipt = extractedReceipts[currentIndex];
  const currentFeedback = feedback[currentIndex];

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

            {/* Extracted fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Vendor Name</label>
                <Input
                  value={currentReceipt.vendor_name || ''}
                  onChange={(e) => handleFieldChange('vendor_name', e.target.value)}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Date</label>
                <Input
                  type="date"
                  value={currentReceipt.receipt_date || ''}
                  onChange={(e) => handleFieldChange('receipt_date', e.target.value)}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Country</label>
                <Input
                  value={currentReceipt.country || ''}
                  onChange={(e) => handleFieldChange('country', e.target.value)}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Currency</label>
                <Input
                  value={currentReceipt.currency || ''}
                  onChange={(e) => handleFieldChange('currency', e.target.value)}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">Total Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  value={currentReceipt.total_amount || ''}
                  onChange={(e) => handleFieldChange('total_amount', parseFloat(e.target.value))}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1">VAT Amount</label>
                <Input
                  type="number"
                  step="0.01"
                  value={currentReceipt.vat_amount || ''}
                  onChange={(e) => handleFieldChange('vat_amount', parseFloat(e.target.value))}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium text-slate-700 block mb-1">VAT Rate (%)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={currentReceipt.vat_rate || ''}
                  onChange={(e) => handleFieldChange('vat_rate', parseFloat(e.target.value))}
                  className={currentFeedback === 'incorrect' ? 'border-amber-400' : ''}
                />
              </div>
            </div>

            {/* Feedback buttons */}
            <div className="flex gap-3 pt-4">
              {!currentFeedback && (
                <>
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
                    Fix Above
                  </Button>
                </>
              )}
              {currentFeedback === 'incorrect' && (
                <Button
                  onClick={markAsCorrect}
                  className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  Corrections Done
                </Button>
              )}
              {currentFeedback && (
                <p className="text-sm text-slate-500 flex items-center">
                  {currentFeedback === 'correct' ? 
                    '✓ Marked as correct' : 
                    '! Make corrections above then mark done'}
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