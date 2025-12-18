import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  Download, FileSpreadsheet, Calendar, Building2, 
  MapPin, TrendingUp, Coins, Percent, Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { base44 } from '@/api/base44Client';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import { format, startOfMonth, endOfMonth, subMonths, parseISO, getMonth, getYear } from 'date-fns';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function Reports() {
  const [dateRange, setDateRange] = useState('last_6_months');
  const [exportFormat, setExportFormat] = useState('excel');

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  const { data: corrections = [] } = useQuery({
    queryKey: ['corrections'],
    queryFn: () => base44.entities.ReceiptCorrection.list('-created_date'),
  });

  // Filter receipts by date range
  const filteredReceipts = useMemo(() => {
    const now = new Date();
    let startDate;

    switch (dateRange) {
      case 'this_month':
        startDate = startOfMonth(now);
        break;
      case 'last_3_months':
        startDate = startOfMonth(subMonths(now, 3));
        break;
      case 'last_6_months':
        startDate = startOfMonth(subMonths(now, 6));
        break;
      case 'last_year':
        startDate = startOfMonth(subMonths(now, 12));
        break;
      default:
        return receipts;
    }

    return receipts.filter(r => {
      if (!r.receipt_date) return false;
      return new Date(r.receipt_date) >= startDate;
    });
  }, [receipts, dateRange]);

  // Calculate monthly VAT data
  const monthlyData = useMemo(() => {
    const monthlyMap = {};
    
    filteredReceipts.forEach(receipt => {
      if (!receipt.receipt_date) return;
      const date = new Date(receipt.receipt_date);
      const key = format(date, 'MMM yyyy');
      
      if (!monthlyMap[key]) {
        monthlyMap[key] = { month: key, vat: 0, total: 0, count: 0 };
      }
      monthlyMap[key].vat += receipt.vat_amount || 0;
      monthlyMap[key].total += receipt.total_amount || 0;
      monthlyMap[key].count += 1;
    });

    return Object.values(monthlyMap).sort((a, b) => {
      const aDate = new Date(a.month);
      const bDate = new Date(b.month);
      return aDate - bDate;
    });
  }, [filteredReceipts]);

  // Calculate vendor breakdown
  const vendorData = useMemo(() => {
    const vendorMap = {};
    
    filteredReceipts.forEach(receipt => {
      const vendor = receipt.vendor_name || 'Unknown';
      if (!vendorMap[vendor]) {
        vendorMap[vendor] = { vendor, vat: 0, total: 0, count: 0 };
      }
      vendorMap[vendor].vat += receipt.vat_amount || 0;
      vendorMap[vendor].total += receipt.total_amount || 0;
      vendorMap[vendor].count += 1;
    });

    return Object.values(vendorMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filteredReceipts]);

  // Calculate country breakdown
  const countryData = useMemo(() => {
    const countryMap = {};
    
    filteredReceipts.forEach(receipt => {
      const country = receipt.country || 'Unknown';
      if (!countryMap[country]) {
        countryMap[country] = { country, vat: 0, total: 0, count: 0 };
      }
      countryMap[country].vat += receipt.vat_amount || 0;
      countryMap[country].total += receipt.total_amount || 0;
      countryMap[country].count += 1;
    });

    return Object.values(countryMap).sort((a, b) => b.vat - a.vat);
  }, [filteredReceipts]);

  // Summary stats
  const summary = useMemo(() => ({
    totalReceipts: filteredReceipts.length,
    totalAmount: filteredReceipts.reduce((sum, r) => sum + (r.total_amount || 0), 0),
    totalVAT: filteredReceipts.reduce((sum, r) => sum + (r.vat_amount || 0), 0),
    uniqueVendors: new Set(filteredReceipts.map(r => r.vendor_name)).size,
    uniqueCountries: new Set(filteredReceipts.map(r => r.country)).size,
    avgConfidence: filteredReceipts.length > 0 
      ? Math.round(filteredReceipts.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / filteredReceipts.length)
      : 0
  }), [filteredReceipts]);

  // Generate Excel export
  const exportToExcel = async () => {
    // Create CSV content
    let csvContent = "data:text/csv;charset=utf-8,";
    
    // Sheet 1: Summary
    csvContent += "SUMMARY REPORT\n\n";
    csvContent += "Metric,Value\n";
    csvContent += `Total Receipts,${summary.totalReceipts}\n`;
    csvContent += `Total Amount,£${summary.totalAmount.toFixed(2)}\n`;
    csvContent += `Total VAT,£${summary.totalVAT.toFixed(2)}\n`;
    csvContent += `Unique Vendors,${summary.uniqueVendors}\n`;
    csvContent += `Countries,${summary.uniqueCountries}\n\n`;

    // Monthly VAT
    csvContent += "MONTHLY VAT BREAKDOWN\n\n";
    csvContent += "Month,VAT Amount,Total Amount,Receipt Count\n";
    monthlyData.forEach(row => {
      csvContent += `${row.month},£${row.vat.toFixed(2)},£${row.total.toFixed(2)},${row.count}\n`;
    });
    csvContent += "\n";

    // Vendor breakdown
    csvContent += "VAT BY VENDOR\n\n";
    csvContent += "Vendor,VAT Amount,Total Amount,Receipt Count\n";
    vendorData.forEach(row => {
      csvContent += `"${row.vendor}",£${row.vat.toFixed(2)},£${row.total.toFixed(2)},${row.count}\n`;
    });
    csvContent += "\n";

    // Country breakdown
    csvContent += "VAT BY COUNTRY\n\n";
    csvContent += "Country,VAT Amount,Total Amount,Receipt Count\n";
    countryData.forEach(row => {
      csvContent += `${row.country},£${row.vat.toFixed(2)},£${row.total.toFixed(2)},${row.count}\n`;
    });
    csvContent += "\n";

    // Detailed receipts
    csvContent += "DETAILED RECEIPTS\n\n";
    csvContent += "Date,Vendor,Country,Currency,Total,VAT,VAT Rate,File,Batch\n";
    filteredReceipts.forEach(r => {
      csvContent += `${r.receipt_date || ''},`;
      csvContent += `"${r.vendor_name || ''}",`;
      csvContent += `${r.country || ''},`;
      csvContent += `${r.currency || ''},`;
      csvContent += `${r.total_amount || 0},`;
      csvContent += `${r.vat_amount || 0},`;
      csvContent += `${r.vat_rate || 0}%,`;
      csvContent += `"${r.file_name || ''}",`;
      csvContent += `${r.upload_batch || ''}\n`;
    });
    csvContent += "\n";

    // Corrections
    if (corrections.length > 0) {
      csvContent += "CORRECTIONS HISTORY\n\n";
      csvContent += "Receipt ID,Field,Original Value,Corrected Value,Corrected By,Date\n";
      corrections.forEach(c => {
        csvContent += `${c.receipt_id || ''},`;
        csvContent += `${c.field_name || ''},`;
        csvContent += `"${c.original_value || ''}",`;
        csvContent += `"${c.corrected_value || ''}",`;
        csvContent += `${c.corrected_by || ''},`;
        csvContent += `${c.created_date ? format(new Date(c.created_date), 'dd/MM/yyyy') : ''}\n`;
      });
    }

    // Download
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vat_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const formatCurrency = (value) => `£${(value || 0).toFixed(2)}`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">VAT Reports</h1>
              <p className="text-slate-500">Generate and export VAT summaries</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-40 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="this_month">This Month</SelectItem>
                <SelectItem value="last_3_months">Last 3 Months</SelectItem>
                <SelectItem value="last_6_months">Last 6 Months</SelectItem>
                <SelectItem value="last_year">Last Year</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button 
              onClick={exportToExcel}
              className="bg-indigo-600 hover:bg-indigo-700 gap-2"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <Coins className="w-5 h-5 text-indigo-600" />
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-1">Total Spend</p>
            <p className="text-2xl font-bold text-slate-800">{formatCurrency(summary.totalAmount)}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <Percent className="w-5 h-5 text-emerald-600" />
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-1">Total VAT</p>
            <p className="text-2xl font-bold text-emerald-600">{formatCurrency(summary.totalVAT)}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-1">Vendors</p>
            <p className="text-2xl font-bold text-slate-800">{summary.uniqueVendors}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-xl border border-slate-200 p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-purple-600" />
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-1">Countries</p>
            <p className="text-2xl font-bold text-slate-800">{summary.uniqueCountries}</p>
          </motion.div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Monthly VAT Trend */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                  Monthly VAT Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `£${v}`} />
                      <Tooltip 
                        formatter={(value) => [`£${value.toFixed(2)}`, '']}
                        contentStyle={{ borderRadius: '8px' }}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="vat" 
                        stroke="#6366f1" 
                        strokeWidth={2}
                        name="VAT"
                        dot={{ fill: '#6366f1' }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke="#10b981" 
                        strokeWidth={2}
                        name="Total"
                        dot={{ fill: '#10b981' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* VAT by Country */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
          >
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-purple-600" />
                  VAT by Country
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={countryData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        fill="#8884d8"
                        paddingAngle={2}
                        dataKey="vat"
                        nameKey="country"
                        label={({ country, percent }) => 
                          `${country} (${(percent * 100).toFixed(0)}%)`
                        }
                      >
                        {countryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        formatter={(value) => [`£${value.toFixed(2)}`, 'VAT']}
                        contentStyle={{ borderRadius: '8px' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Top Vendors */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600" />
                Top 10 Vendors by Spend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={vendorData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis type="number" tickFormatter={(v) => `£${v}`} tick={{ fontSize: 12 }} />
                    <YAxis 
                      type="category" 
                      dataKey="vendor" 
                      width={120}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip 
                      formatter={(value) => [`£${value.toFixed(2)}`, '']}
                      contentStyle={{ borderRadius: '8px' }}
                    />
                    <Legend />
                    <Bar dataKey="total" fill="#6366f1" name="Total" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="vat" fill="#10b981" name="VAT" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}