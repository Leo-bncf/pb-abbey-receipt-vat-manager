import React from 'react';
import { motion } from 'framer-motion';
import { 
  FileText, Calendar, Building2, MapPin, Coins, 
  Percent, AlertCircle, CheckCircle, Clock, Eye 
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

const statusConfig = {
  uploaded: { color: 'bg-slate-100 text-slate-600', icon: Clock, label: 'Uploaded' },
  processing: { color: 'bg-amber-100 text-amber-700', icon: Clock, label: 'Processing' },
  extracted: { color: 'bg-blue-100 text-blue-700', icon: CheckCircle, label: 'Extracted' },
  reviewed: { color: 'bg-green-100 text-green-700', icon: CheckCircle, label: 'Reviewed' },
  error: { color: 'bg-red-100 text-red-700', icon: AlertCircle, label: 'Error' }
};

export default function ReceiptCard({ receipt, onView, index = 0 }) {
  const status = statusConfig[receipt.status] || statusConfig.uploaded;
  const StatusIcon = status.icon;

  const formatCurrency = (amount, currency) => {
    if (!amount && amount !== 0) return '-';
    const symbols = { GBP: '£', EUR: '€', USD: '$' };
    const symbol = symbols[currency] || currency || '';
    return `${symbol}${Number(amount).toFixed(2)}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white rounded-xl border border-slate-200 overflow-hidden hover:shadow-lg hover:border-slate-300 transition-all duration-300"
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-slate-500" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 truncate max-w-[180px]">
                {receipt.vendor_name || 'Unknown Vendor'}
              </h3>
              <p className="text-xs text-slate-400 truncate max-w-[180px]">
                {receipt.file_name}
              </p>
            </div>
          </div>
          <Badge className={`${status.color} border-0 gap-1`}>
            <StatusIcon className="w-3 h-3" />
            {status.label}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">
              {receipt.receipt_date 
                ? format(new Date(receipt.receipt_date), 'dd MMM yyyy')
                : '-'
              }
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <MapPin className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">{receipt.country || '-'}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Coins className="w-4 h-4 text-slate-400" />
            <span className="text-slate-800 font-semibold">
              {formatCurrency(receipt.total_amount, receipt.currency)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Percent className="w-4 h-4 text-slate-400" />
            <span className="text-slate-600">
              VAT: {formatCurrency(receipt.vat_amount, receipt.currency)}
            </span>
          </div>
        </div>

        {receipt.needs_review && !receipt.is_reviewed && (
          <div className="flex items-center gap-2 p-2 bg-amber-50 rounded-lg mb-4">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <span className="text-xs text-amber-700">Needs review</span>
          </div>
        )}

        {receipt.confidence_score !== undefined && (
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-500">Confidence</span>
              <span className={`font-medium ${
                receipt.confidence_score >= 80 ? 'text-green-600' :
                receipt.confidence_score >= 50 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {receipt.confidence_score}%
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${receipt.confidence_score}%` }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className={`h-full rounded-full ${
                  receipt.confidence_score >= 80 ? 'bg-green-500' :
                  receipt.confidence_score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                }`}
              />
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onView(receipt)}
          className="w-full"
        >
          <Eye className="w-4 h-4 mr-2" />
          View Details
        </Button>
      </div>
    </motion.div>
  );
}