import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Check, X, ThumbsUp, ThumbsDown, 
  Sparkles, Building2, Calendar,
  MapPin, Coins, Percent
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function AITrainingPanel({ receipt, onFieldCorrection, onSendFeedback }) {
  const [corrections, setCorrections] = useState({});
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');

  if (!receipt) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center h-full flex flex-col items-center justify-center">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
          <Sparkles className="w-8 h-8 text-slate-400" />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-2">Select a Receipt to Train</h3>
        <p className="text-slate-500">
          Choose a receipt from the list to verify AI extraction and provide training feedback
        </p>
      </div>
    );
  }

  const fields = [
    { 
      key: 'vendor_name', 
      label: 'Vendor Name', 
      value: receipt.vendor_name,
      icon: Building2,
      color: 'indigo'
    },
    { 
      key: 'receipt_date', 
      label: 'Receipt Date', 
      value: receipt.receipt_date,
      icon: Calendar,
      color: 'blue'
    },
    { 
      key: 'country', 
      label: 'Country', 
      value: receipt.country,
      icon: MapPin,
      color: 'purple'
    },
    { 
      key: 'currency', 
      label: 'Currency', 
      value: receipt.currency,
      icon: Coins,
      color: 'emerald'
    },
    { 
      key: 'total_amount', 
      label: 'Total Amount', 
      value: receipt.total_amount,
      icon: Coins,
      color: 'amber',
      isNumber: true
    },
    { 
      key: 'vat_amount', 
      label: 'VAT Amount', 
      value: receipt.vat_amount,
      icon: Percent,
      color: 'rose',
      isNumber: true
    },
    { 
      key: 'vat_rate', 
      label: 'VAT Rate (%)', 
      value: receipt.vat_rate,
      icon: Percent,
      color: 'green',
      isNumber: true
    }
  ];

  const handleMarkCorrect = (field) => {
    setCorrections(prev => ({
      ...prev,
      [field.key]: { status: 'correct', original: field.value }
    }));
    
    // Send feedback to chat
    onSendFeedback(`The ${field.label} "${field.value}" is correct.`);
  };

  const handleMarkIncorrect = (field) => {
    setEditingField(field.key);
    setEditValue(field.value || '');
  };

  const handleSaveCorrection = (field) => {
    const newValue = field.isNumber ? parseFloat(editValue) : editValue;
    
    setCorrections(prev => ({
      ...prev,
      [field.key]: { 
        status: 'incorrect', 
        original: field.value,
        corrected: newValue
      }
    }));
    
    // Send feedback to chat
    onSendFeedback(
      `The ${field.label} is incorrect. The AI extracted "${field.value}" but the correct value is "${newValue}". Please learn from this.`
    );
    
    // Update the receipt
    onFieldCorrection(receipt.id, field.key, field.value, newValue);
    
    setEditingField(null);
    setEditValue('');
  };

  const getFieldStatus = (fieldKey) => {
    return corrections[fieldKey]?.status || null;
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Train AI on Receipt</h2>
            <p className="text-xs text-slate-500">{receipt.file_name}</p>
          </div>
        </div>
        {receipt.confidence_score !== undefined && (
          <Badge className={`${
            receipt.confidence_score >= 80 ? 'bg-green-100 text-green-700' :
            receipt.confidence_score >= 50 ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
            {receipt.confidence_score}% confidence
          </Badge>
        )}
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

        {/* Extracted Fields */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-slate-800">AI Extracted Data</h3>
            <span className="text-xs text-slate-500">
              Mark each field as correct or incorrect
            </span>
          </div>

          <div className="space-y-3">
            {fields.map((field) => {
              const status = getFieldStatus(field.key);
              const isEditing = editingField === field.key;
              const FieldIcon = field.icon;

              return (
                <motion.div
                  key={field.key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    status === 'correct' ? 'bg-green-50 border-green-200' :
                    status === 'incorrect' ? 'bg-red-50 border-red-200' :
                    'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className={`w-8 h-8 rounded-lg bg-${field.color}-100 flex items-center justify-center flex-shrink-0 mt-1`}>
                        <FieldIcon className={`w-4 h-4 text-${field.color}-600`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 mb-1">
                          {field.label}
                        </p>
                        
                        {!isEditing ? (
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold ${
                              status === 'correct' ? 'text-green-700' :
                              status === 'incorrect' ? 'text-red-600 line-through' :
                              'text-slate-800'
                            }`}>
                              {field.value || '-'}
                            </p>
                            {status === 'incorrect' && corrections[field.key]?.corrected && (
                              <p className="font-semibold text-green-600">
                                → {corrections[field.key].corrected}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="flex gap-2 mt-1">
                            <Input
                              type={field.isNumber ? 'number' : 'text'}
                              step={field.isNumber ? '0.01' : undefined}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="Enter correct value"
                              className="h-9"
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => handleSaveCorrection(field)}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingField(null);
                                setEditValue('');
                              }}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        )}

                        {status && (
                          <p className="text-xs text-slate-500 mt-1">
                            {status === 'correct' ? 'Marked as correct ✓' : 'Corrected'}
                          </p>
                        )}
                      </div>
                    </div>

                    {!isEditing && !status && (
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkCorrect(field)}
                          className="text-green-600 hover:bg-green-50 hover:text-green-700"
                          title="Mark as correct"
                        >
                          <ThumbsUp className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkIncorrect(field)}
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          title="Mark as incorrect"
                        >
                          <ThumbsDown className="w-4 h-4" />
                        </Button>
                      </div>
                    )}

                    {status && (
                      <Badge className={`${
                        status === 'correct' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {status === 'correct' ? 'Correct' : 'Corrected'}
                      </Badge>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* OCR Text Reference */}
        {receipt.ocr_text && (
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Original OCR Text (for reference)
            </h3>
            <div className="p-4 bg-slate-50 rounded-xl max-h-48 overflow-y-auto">
              <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono">
                {receipt.ocr_text}
              </pre>
            </div>
          </div>
        )}

        {/* Summary */}
        {Object.keys(corrections).length > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-4 bg-indigo-50 rounded-xl border border-indigo-200"
          >
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h3 className="font-semibold text-indigo-800">Training Summary</h3>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-slate-700">
                  <strong className="text-green-600">
                    {Object.values(corrections).filter(c => c.status === 'correct').length}
                  </strong> correct
                </span>
              </div>
              <div className="flex items-center gap-2">
                <X className="w-4 h-4 text-red-600" />
                <span className="text-slate-700">
                  <strong className="text-red-600">
                    {Object.values(corrections).filter(c => c.status === 'incorrect').length}
                  </strong> corrected
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}