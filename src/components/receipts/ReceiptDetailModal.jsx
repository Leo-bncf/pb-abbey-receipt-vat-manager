import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, FileText, Calendar, Building2, MapPin, Coins, 
  Percent, CheckCircle, AlertCircle, ExternalLink, Copy, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

export default function ReceiptDetailModal({ receipt, isOpen, onClose }) {
  if (!isOpen || !receipt) return null;

  // Check if this is from a multi-receipt file
  const isMultiReceipt = receipt.extraction_notes?.includes('receipts from same image') || 
                         receipt.file_name?.includes('[');
  const locationMatch = receipt.extraction_notes?.match(/\[Location: ([^\]]+)\]/);
  const location = locationMatch ? locationMatch[1] : null;
  
  // Extract page number if mentioned (e.g., "page 2", "page 5")
  const pageMatch = receipt.extraction_notes?.match(/page (\d+)/i) || location?.match(/page (\d+)/i);
  const pageNumber = pageMatch ? parseInt(pageMatch[1]) : null;
  
  // For PDFs, append page number to URL
  const displayUrl = receipt.file_type === 'pdf' && pageNumber 
    ? `${receipt.file_url}#page=${pageNumber}`
    : receipt.file_url;

  const formatCurrency = (amount, currency) => {
    if (!amount && amount !== 0) return '-';
    const symbols = { GBP: '£', EUR: '€', USD: '$' };
    const symbol = symbols[currency] || currency || '';
    return `${symbol}${Number(amount).toFixed(2)}`;
  };

  const fields = [
    { label: 'Vendor', value: receipt.vendor_name, icon: Building2 },
    { label: 'Date', value: receipt.receipt_date ? format(new Date(receipt.receipt_date), 'dd MMMM yyyy') : '-', icon: Calendar },
    { label: 'Country', value: receipt.country, icon: MapPin },
    { label: 'Currency', value: receipt.currency, icon: Coins },
    { label: 'Total Amount', value: formatCurrency(receipt.total_amount, receipt.currency), icon: Coins, highlight: true },
    { label: 'VAT Amount', value: formatCurrency(receipt.vat_amount, receipt.currency), icon: Percent, highlight: true },
    { label: 'VAT Rate', value: receipt.vat_rate ? `${receipt.vat_rate}%` : '-', icon: Percent },
    { label: 'VAT Explicit', value: receipt.vat_explicit ? 'Yes' : 'Calculated', icon: CheckCircle },
    { label: 'Tax Free', value: receipt.is_tax_free ? 'Yes' : 'No', icon: AlertCircle },
  ];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Receipt Details</h2>
                <p className="text-sm text-slate-500">{receipt.file_name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-col lg:flex-row max-h-[calc(90vh-80px)] overflow-hidden">
            {/* Left: Image Preview */}
            <div className="lg:w-1/2 p-6 bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-700">
              {isMultiReceipt && location && (
                <div className="mb-4 p-3 bg-amber-500/20 border border-amber-500/30 rounded-lg flex items-start gap-2">
                  <Info className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-amber-200 font-medium">Multi-receipt file</p>
                    <p className="text-xs text-amber-300 mt-1">
                      This receipt is located at: <span className="font-semibold">{location}</span>
                    </p>
                    <p className="text-xs text-amber-400 mt-1">
                      Look for vendor "{receipt.vendor_name}" with total {receipt.total_amount} {receipt.currency}
                    </p>
                  </div>
                </div>
              )}
              <div className="aspect-[3/4] rounded-xl bg-slate-800 border border-slate-700 overflow-auto relative">
                {displayUrl ? (
                  receipt.file_type === 'pdf' ? (
                    <iframe 
                      src={displayUrl} 
                      className="w-full h-full"
                      title="Receipt PDF"
                    />
                  ) : (
                    <img 
                      src={displayUrl} 
                      alt="Receipt" 
                      className="w-full h-full object-contain cursor-pointer hover:opacity-90 transition-all"
                      onClick={() => window.open(displayUrl, '_blank')}
                      style={{ imageRendering: 'crisp-edges' }}
                    />
                  )
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500">
                    <FileText className="w-16 h-16" />
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full bg-slate-800 border-slate-600 text-slate-200 hover:bg-slate-700"
                onClick={() => window.open(displayUrl, '_blank')}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                {pageNumber ? `Open Page ${pageNumber}` : 'Open Full Size'}
              </Button>
            </div>

            {/* Right: Extracted Data */}
            <div className="lg:w-1/2 p-6 overflow-y-auto">
              <div className="space-y-6">
                {/* Status & Confidence */}
                <div className="flex items-center gap-3 flex-wrap">
                  <Badge className={`
                    ${receipt.status === 'reviewed' ? 'bg-green-100 text-green-700' :
                      receipt.status === 'extracted' ? 'bg-blue-100 text-blue-700' :
                      receipt.status === 'error' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-600'}
                  `}>
                    {receipt.status}
                  </Badge>
                  {receipt.confidence_score !== undefined && (
                    <Badge variant="outline" className={`
                      ${receipt.confidence_score >= 80 ? 'border-green-200 text-green-700' :
                        receipt.confidence_score >= 50 ? 'border-amber-200 text-amber-700' :
                        'border-red-200 text-red-700'}
                    `}>
                      {receipt.confidence_score}% confidence
                    </Badge>
                  )}
                  {receipt.needs_review && !receipt.is_reviewed && (
                    <Badge className="bg-amber-100 text-amber-700">
                      Needs Review
                    </Badge>
                  )}
                </div>

                {/* Extracted Fields */}
                <div className="space-y-3">
                  {fields.map((field, index) => (
                    <div 
                      key={field.label}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        field.highlight ? 'bg-indigo-50' : 'bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <field.icon className={`w-4 h-4 ${
                          field.highlight ? 'text-indigo-600' : 'text-slate-400'
                        }`} />
                        <span className="text-sm text-slate-600">{field.label}</span>
                      </div>
                      <span className={`text-sm font-medium ${
                        field.highlight ? 'text-indigo-700' : 'text-slate-800'
                      }`}>
                        {field.value || '-'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* OCR Text */}
                {receipt.ocr_text && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-slate-700">OCR Text</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(receipt.ocr_text)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg max-h-48 overflow-y-auto">
                      <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono">
                        {receipt.ocr_text}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Extraction Notes */}
                {receipt.extraction_notes && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="text-sm font-semibold text-blue-800 mb-1">AI Notes</h3>
                    <p className="text-sm text-blue-700">{receipt.extraction_notes}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}