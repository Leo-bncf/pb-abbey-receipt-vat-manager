import React from 'react';
import { motion } from 'framer-motion';
import { 
  Table, TableBody, TableCell, TableHead, 
  TableHeader, TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Eye, 
  ChevronUp, ChevronDown 
} from 'lucide-react';
import { format } from 'date-fns';

const statusConfig = {
  uploaded: { color: 'bg-slate-100 text-slate-600', label: 'Uploaded' },
  processing: { color: 'bg-amber-100 text-amber-700', label: 'Processing' },
  extracted: { color: 'bg-blue-100 text-blue-700', label: 'Extracted' },
  reviewed: { color: 'bg-green-100 text-green-700', label: 'Reviewed' },
  error: { color: 'bg-red-100 text-red-700', label: 'Error' }
};

export default function ReceiptTable({ 
  receipts, 
  onView, 
  selectedIds = [], 
  onSelectionChange,
  sortField,
  sortDirection,
  onSort
}) {
  const formatCurrency = (amount, currency) => {
    if (!amount && amount !== 0) return '-';
    const symbols = { GBP: '£', EUR: '€', USD: '$' };
    const symbol = symbols[currency] || currency || '';
    return `${symbol}${Number(amount).toFixed(2)}`;
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      onSelectionChange(receipts.map(r => r.id));
    } else {
      onSelectionChange([]);
    }
  };

  const handleSelectOne = (id, checked) => {
    if (checked) {
      onSelectionChange([...selectedIds, id]);
    } else {
      onSelectionChange(selectedIds.filter(i => i !== id));
    }
  };

  const SortHeader = ({ field, children }) => (
    <button
      onClick={() => onSort(field)}
      className="flex items-center gap-1 hover:text-slate-900 transition-colors"
    >
      {children}
      {sortField === field && (
        sortDirection === 'asc' 
          ? <ChevronUp className="w-4 h-4" />
          : <ChevronDown className="w-4 h-4" />
      )}
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead className="w-12">
                <Checkbox 
                  checked={selectedIds.length === receipts.length && receipts.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead>
                <SortHeader field="vendor_name">Vendor</SortHeader>
              </TableHead>
              <TableHead>
                <SortHeader field="receipt_date">Date</SortHeader>
              </TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-right">
                <SortHeader field="total_amount">Total</SortHeader>
              </TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((receipt, index) => {
              const status = statusConfig[receipt.status] || statusConfig.uploaded;
              return (
                <motion.tr
                  key={receipt.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-slate-50 transition-colors"
                >
                  <TableCell>
                    <Checkbox 
                      checked={selectedIds.includes(receipt.id)}
                      onCheckedChange={(checked) => handleSelectOne(receipt.id, checked)}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-slate-800">
                        {receipt.vendor_name || 'Unknown'}
                      </p>
                      <p className="text-xs text-slate-400 truncate max-w-[150px]">
                        {receipt.file_name}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {receipt.receipt_date 
                      ? format(new Date(receipt.receipt_date), 'dd/MM/yyyy')
                      : '-'
                    }
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {receipt.country || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-slate-800">
                    {formatCurrency(receipt.total_amount, receipt.currency)}
                  </TableCell>
                  <TableCell className="text-right text-slate-600">
                    {formatCurrency(receipt.vat_amount, receipt.currency)}
                    {receipt.vat_rate && (
                      <span className="text-xs text-slate-400 ml-1">
                        ({receipt.vat_rate}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={`${status.color} border-0`}>
                      {status.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {receipt.confidence_score !== undefined ? (
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${
                              receipt.confidence_score >= 80 ? 'bg-green-500' :
                              receipt.confidence_score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${receipt.confidence_score}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {receipt.confidence_score}%
                        </span>
                      </div>
                    ) : '-'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onView(receipt)}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </motion.tr>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {receipts.length === 0 && (
        <div className="p-12 text-center text-slate-500">
          No receipts found
        </div>
      )}
    </div>
  );
}