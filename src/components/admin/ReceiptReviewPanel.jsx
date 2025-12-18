import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { 
  Save, X, Check, AlertTriangle, FileText, 
  Calendar, Building2, MapPin, Coins, Percent,
  MessageSquare, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function ReceiptReviewPanel({ 
  receipt, 
  onSave, 
  onClose, 
  isSaving,
  countries = []
}) {
  const [formData, setFormData] = useState({});
  const [corrections, setCorrections] = useState({});

  useEffect(() => {
    if (receipt) {
      setFormData({
        vendor_name: receipt.vendor_name || '',
        receipt_date: receipt.receipt_date || '',
        country: receipt.country || '',
        currency: receipt.currency || 'GBP',
        total_amount: receipt.total_amount || '',
        vat_amount: receipt.vat_amount || '',
        vat_rate: receipt.vat_rate || '',
        vat_explicit: receipt.vat_explicit || false,
        is_tax_free: receipt.is_tax_free || false,
      });
      setCorrections({});
    }
  }, [receipt]);

  const handleChange = (field, value) => {
    const oldValue = formData[field];
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Track corrections
    if (oldValue !== value && receipt[field] !== value) {
      setCorrections(prev => ({
        ...prev,
        [field]: {
          original: receipt[field],
          corrected: value
        }
      }));
    }
  };

  const handleTaxFreeChange = (checked) => {
    handleChange('is_tax_free', checked);
    if (checked) {
      handleChange('vat_amount', 0);
      handleChange('vat_rate', 0);
    }
  };

  const handleSave = () => {
    onSave({
      ...formData,
      total_amount: parseFloat(formData.total_amount) || 0,
      vat_amount: parseFloat(formData.vat_amount) || 0,
      vat_rate: parseFloat(formData.vat_rate) || 0,
      is_reviewed: true,
      reviewed_date: new Date().toISOString(),
    }, corrections);
  };

  const currencies = ['GBP', 'EUR', 'USD', 'CHF', 'JPY', 'CAD', 'AUD'];

  if (!receipt) return null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-white rounded-2xl border border-slate-200 overflow-hidden h-full flex flex-col"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <FileText className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Review Receipt</h2>
            <p className="text-xs text-slate-500">{receipt.file_name}</p>
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
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Receipt Preview */}
        <div className="aspect-video rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
          {receipt.file_url ? (
            receipt.file_type === 'pdf' ? (
              <iframe 
                src={receipt.file_url} 
                className="w-full h-full"
                title="Receipt PDF"
              />
            ) : (
              <img 
                src={receipt.file_url} 
                alt="Receipt" 
                className="w-full h-full object-contain"
              />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400">
              <FileText className="w-12 h-12" />
            </div>
          )}
        </div>

        {/* Confidence Warning */}
        {receipt.confidence_score < 70 && (
          <div className="flex items-center gap-3 p-4 bg-amber-50 rounded-xl">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">Low Confidence Score</p>
              <p className="text-xs text-amber-600">
                AI confidence is {receipt.confidence_score}%. Please verify all fields.
              </p>
            </div>
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="text-slate-700">Vendor Name</Label>
              <Input
                value={formData.vendor_name}
                onChange={(e) => handleChange('vendor_name', e.target.value)}
                className="mt-1"
                placeholder="Enter vendor name"
              />
              {corrections.vendor_name && (
                <p className="text-xs text-amber-600 mt-1">
                  Changed from: {corrections.vendor_name.original || 'empty'}
                </p>
              )}
            </div>

            <div>
              <Label className="text-slate-700">Receipt Date</Label>
              <Input
                type="date"
                value={formData.receipt_date}
                onChange={(e) => handleChange('receipt_date', e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-slate-700">Country</Label>
              <Input
                value={formData.country}
                onChange={(e) => handleChange('country', e.target.value)}
                className="mt-1"
                placeholder="e.g. United Kingdom"
              />
            </div>

            <div>
              <Label className="text-slate-700">Currency</Label>
              <Select 
                value={formData.currency} 
                onValueChange={(v) => handleChange('currency', v)}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-slate-700">Total Amount</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.total_amount}
                onChange={(e) => handleChange('total_amount', e.target.value)}
                className="mt-1"
                placeholder="0.00"
              />
              {corrections.total_amount && (
                <p className="text-xs text-amber-600 mt-1">
                  Changed from: {corrections.total_amount.original}
                </p>
              )}
            </div>
          </div>

          {/* Tax Free Toggle */}
          <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
            <div>
              <p className="font-medium text-slate-800">Tax Free Receipt</p>
              <p className="text-xs text-slate-500">No VAT applies to this receipt</p>
            </div>
            <Switch
              checked={formData.is_tax_free}
              onCheckedChange={handleTaxFreeChange}
            />
          </div>

          {!formData.is_tax_free && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-slate-700">VAT Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.vat_amount}
                  onChange={(e) => handleChange('vat_amount', e.target.value)}
                  className="mt-1"
                  placeholder="0.00"
                />
                {corrections.vat_amount && (
                  <p className="text-xs text-amber-600 mt-1">
                    Changed from: {corrections.vat_amount.original}
                  </p>
                )}
              </div>

              <div>
                <Label className="text-slate-700">VAT Rate (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={formData.vat_rate}
                  onChange={(e) => handleChange('vat_rate', e.target.value)}
                  className="mt-1"
                  placeholder="20"
                />
              </div>

              <div className="col-span-2 flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                <div>
                  <p className="font-medium text-slate-800">VAT Explicitly Shown</p>
                  <p className="text-xs text-slate-500">VAT was displayed on the receipt</p>
                </div>
                <Switch
                  checked={formData.vat_explicit}
                  onCheckedChange={(v) => handleChange('vat_explicit', v)}
                />
              </div>
            </div>
          )}
        </div>

        {/* OCR Text Reference */}
        {receipt.ocr_text && (
          <div>
            <Label className="text-slate-700 mb-2 block">OCR Text Reference</Label>
            <div className="p-4 bg-slate-50 rounded-xl max-h-40 overflow-y-auto">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono">
                {receipt.ocr_text}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {Object.keys(corrections).length > 0 && (
            <span className="text-amber-600">
              {Object.keys(corrections).length} field(s) modified
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave}
            disabled={isSaving}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Approve & Save
              </>
            )}
          </Button>
        </div>
      </div>
    </motion.div>
  );
}