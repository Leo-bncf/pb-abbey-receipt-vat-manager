import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, FileText, Calendar, Building2, MapPin, Coins, 
  Percent, CheckCircle, AlertCircle, ExternalLink, Copy, Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import ReceiptCrop from './ReceiptCrop';

export default function ReceiptDetailModal({ receipt, isOpen, onClose }) {
  if (!isOpen || !receipt) return null;

  // Check if this is from a multi-receipt file
  const isMultiReceipt = receipt.extraction_notes?.includes('receipts from same image') || 
                         receipt.file_name?.includes('[');
  const locationMatch = receipt.extraction_notes?.match(/\[Location: ([^\]]+)\]/);
  const location = locationMatch ? locationMatch[1] : null;
  
  // Extract page number if mentioned (e.g., "page 2", "page 5")
  const pageMatch = receipt.extraction_notes?.match(/page (\d+)/i) || location?.match(/page (\d+)/i);
  const pageNumber = receipt.page_number || (pageMatch ? parseInt(pageMatch[1]) : null);
  const hasBox = Array.isArray(receipt.box_2d) && receipt.box_2d.length === 4;
  
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
    { label: 'Date', value: receipt.receipt_date ? format(new Date(receipt.receipt_date), 'dd/MM/yyyy') : '-', icon: Calendar },
    { label: 'Country', value: receipt.country, icon: MapPin },
    { label: 'Currency', value: receipt.currency, icon: Coins },
    { label: 'Total Amount', value: formatCurrency(receipt.total_amount, receipt.currency), icon: Coins, highlight: true },
    { label: 'VAT Amount', value: formatCurrency(receipt.vat_amount, receipt.currency), icon: Percent, highlight: true },
    { label: 'VAT Rate', value: receipt.vat_rate ? `${receipt.vat_rate}%` : '-', icon: Percent },
    { label: 'VAT', value: receipt.vat_explicit ? 'Printed on receipt' : (receipt.vat_inferred ? 'Rate inferred (not printed)' : 'Calculated from rate'), icon: CheckCircle },
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
          className="bg-white rounded max-w-4xl w-full max-h-[90vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded bg-neutral-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-neutral-900" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Receipt Details</h2>
                <p className="text-sm text-neutral-500">{receipt.file_name}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-neutral-500" />
            </button>
          </div>

          {/* Content */}
          <div className="flex flex-col lg:flex-row max-h-[calc(90vh-80px)] overflow-hidden">
            {/* Left: Image Preview */}
            <div className="lg:w-1/2 p-6 bg-neutral-900 border-b lg:border-b-0 lg:border-r border-neutral-700">
              {isMultiReceipt && location && !hasBox && (
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
              <div className="aspect-[3/4] rounded bg-neutral-900 border border-neutral-700 overflow-hidden relative">
                {receipt.file_url ? (
                  <ReceiptCrop fileUrl={receipt.file_url} fileType={receipt.file_type} pageNumber={pageNumber}
                    box={hasBox ? receipt.box_2d : null} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-neutral-500">
                    <FileText className="w-16 h-16" />
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full bg-neutral-900 border-neutral-600 text-neutral-200 hover:bg-neutral-700"
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
                      'bg-neutral-100 text-neutral-600'}
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

                {receipt.verification && receipt.verification !== 'OK' && (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
                    <p className="font-semibold">Check this one against the receipt</p>
                    <p className="mt-0.5">
                      Second reader: {receipt.verification}
                      {receipt.verifier_amount != null && ` — it read ${formatCurrency(receipt.verifier_amount, receipt.currency)}`}
                      {receipt.verifier_date && ` on ${format(new Date(receipt.verifier_date), 'dd/MM/yyyy')}`}.
                    </p>
                  </div>
                )}
                {receipt.verification === 'OK' && (
                  <p className="text-[12px] text-emerald-700 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Amount and date confirmed by two independent readers</p>
                )}

                {/* Extracted Fields */}
                <div className="space-y-3">
                  {fields.map((field) => (
                    <div 
                      key={field.label}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        field.highlight ? 'bg-neutral-50' : 'bg-neutral-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <field.icon className={`w-4 h-4 ${
                          field.highlight ? 'text-neutral-900' : 'text-neutral-400'
                        }`} />
                        <span className="text-sm text-neutral-600">{field.label}</span>
                      </div>
                      <span className={`text-sm font-medium ${
                        field.highlight ? 'text-neutral-800' : 'text-neutral-900'
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
                      <h3 className="text-sm font-semibold text-neutral-700">OCR Text</h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(receipt.ocr_text)}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                    <div className="p-4 bg-neutral-50 rounded-lg max-h-48 overflow-y-auto">
                      <pre className="text-xs text-neutral-600 whitespace-pre-wrap font-mono">
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