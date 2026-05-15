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
  const [dateRange, setDateRange] = useState('all');
  const [exportMonth, setExportMonth] = useState('');

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
    if (dateRange === 'all') return receipts;

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
      // Include receipts without dates when filtering by date
      if (!r.receipt_date) return true;
      return new Date(r.receipt_date) >= startDate;
    });
  }, [receipts, dateRange]);

  // Calculate monthly VAT data
  const monthlyData = useMemo(() => {
    const monthlyMap = {};
    
    filteredReceipts.forEach(receipt => {
      let key;
      if (receipt.receipt_date) {
        const date = new Date(receipt.receipt_date);
        key = format(date, 'MMM yyyy');
      } else {
        // Use created_date for receipts without receipt_date
        const date = new Date(receipt.created_date);
        key = format(date, 'MMM yyyy');
      }
      
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

  // Available months for export dropdown (derived from receipts)
  const availableMonths = useMemo(() => {
    const monthSet = new Set();
    receipts.forEach(r => {
      const dateStr = r.receipt_date || r.created_date;
      if (dateStr) {
        monthSet.add(format(new Date(dateStr), 'yyyy-MM'));
      }
    });
    return Array.from(monthSet).sort().reverse().map(m => ({
      value: m,
      label: format(new Date(m + '-01'), 'MMMM yyyy')
    }));
  }, [receipts]);

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

  // Generate monthly export
  const [isExporting, setIsExporting] = useState(false);

  const exportToExcel = async () => {
    if (!exportMonth) return;
    setIsExporting(true);

    // Filter receipts for selected month
    const [year, month] = exportMonth.split('-').map(Number);
    const monthReceipts = receipts.filter(r => {
      const dateStr = r.receipt_date || r.created_date;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });

    const monthLabel = format(new Date(exportMonth + '-01'), 'MMMM yyyy');

    // Fetch EUR/GBP exchange rate
    let eurToGbp = 1;
    try {
      const rateResult = await base44.integrations.Core.InvokeLLM({
        prompt: `What is today's EUR to GBP exchange rate? Return just the number.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: 'object',
          properties: { rate: { type: 'number' } }
        }
      });
      eurToGbp = rateResult.rate || 1;
    } catch (e) {
      console.error('Failed to fetch exchange rate:', e);
    }

    // Compute summary for this month
    const totalAmount = monthReceipts.reduce((s, r) => s + (r.total_amount || 0), 0);
    const totalVAT = monthReceipts.reduce((s, r) => s + (r.vat_amount || 0), 0);
    const uniqueVendors = new Set(monthReceipts.map(r => r.vendor_name)).size;

    // Vendor breakdown
    const vendorMap = {};
    monthReceipts.forEach(r => {
      const v = r.vendor_name || 'Unknown';
      if (!vendorMap[v]) vendorMap[v] = { vat: 0, total: 0, count: 0 };
      vendorMap[v].vat += r.vat_amount || 0;
      vendorMap[v].total += r.total_amount || 0;
      vendorMap[v].count += 1;
    });
    const vendorRows = Object.entries(vendorMap).sort((a, b) => b[1].total - a[1].total);

    const row = (cols) => cols.map(c => {
      const val = c == null ? '' : String(c);
      // Wrap in quotes if contains comma, quote, or newline
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',');

    const lines = [];

    // Sheet header
    lines.push(row([`VAT Report - ${monthLabel}`]));
    lines.push(row([]));

    // Summary block
    lines.push(row(['SUMMARY', '']));
    lines.push(row(['Month', monthLabel]));
    lines.push(row(['Total Receipts', monthReceipts.length]));
    lines.push(row(['Total Amount (GBP)', totalAmount.toFixed(2)]));
    lines.push(row(['Total VAT (GBP)', totalVAT.toFixed(2)]));
    lines.push(row(['Unique Vendors', uniqueVendors]));
    lines.push(row([]));

    // VAT by vendor
    lines.push(row(['VENDOR BREAKDOWN', '', '', '']));
    lines.push(row(['Vendor', 'Total Amount', 'VAT Amount', 'Receipt Count']));
    vendorRows.forEach(([vendor, data]) => {
      lines.push(row([vendor, data.total.toFixed(2), data.vat.toFixed(2), data.count]));
    });
    lines.push(row([]));

    // Detailed receipts
    lines.push(row(['DETAILED RECEIPTS', '', '', '', '', '', '', '', '', '']));
    lines.push(row(['Date', 'Vendor', 'Country', 'Currency', 'Total', 'Total (GBP)', 'VAT', 'VAT Rate %', 'VAT Explicit', 'File Name']));
    monthReceipts.forEach(r => {
      const total = r.total_amount || 0;
      const totalGbp = r.currency === 'EUR' ? (total * eurToGbp) : total;
      lines.push(row([
        r.receipt_date || '',
        r.vendor_name || '',
        r.country || '',
        r.currency || '',
        total.toFixed(2),
        totalGbp.toFixed(2),
        (r.vat_amount || 0).toFixed(2),
        r.vat_rate || 0,
        r.vat_explicit ? 'Yes' : 'No',
        r.file_name || ''
      ]));
    });

    const csvContent = "data:text/csv;charset=utf-8," + lines.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `vat_report_${exportMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setIsExporting(false);
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
          <div className="flex gap-3 items-center flex-wrap">
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
            <div className="flex gap-2 items-center border border-slate-200 bg-white rounded-lg px-3 py-1.5">
              <Calendar className="w-4 h-4 text-slate-400" />
              <Select value={exportMonth} onValueChange={setExportMonth}>
                <SelectTrigger className="w-40 border-0 p-0 h-auto shadow-none focus:ring-0">
                  <SelectValue placeholder="Select month..." />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button 
              onClick={exportToExcel}
              disabled={!exportMonth || isExporting}
              className="bg-indigo-600 hover:bg-indigo-700 gap-2 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export Month'}
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