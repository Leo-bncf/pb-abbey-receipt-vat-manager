import { wsPath } from '@/lib/workspace';
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { 
  Download, FileSpreadsheet, Folder, Building2,
  MapPin, TrendingUp, Coins, Percent
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { base44 } from '@/api/base44Client';
import AppShell, { StatStrip } from '@/components/AppShell';
import YearEndPack from '@/components/reports/YearEndPack';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line, Legend
} from 'recharts';
import { format, startOfMonth, subMonths } from 'date-fns';
import { newWorkbook, tableSheet, summarySheet, download } from '@/lib/excel';

// Professional chart palette: navy + slate tones
const COLORS = ['#171717', '#525252', '#737373', '#a3a3a3', '#d4d4d4', '#404040', '#8a8a8a'];

export default function Reports() {
  // Single scope: a folder ('all', 'root', or a folder id) — chosen like the
  // document explorer. No date-range controls.
  const [exportFolder, setExportFolder] = useState('all');
  // Leave receipts still waiting in the "To check" queue out of the export by default.
  const [skipUnchecked, setSkipUnchecked] = useState(true);

  const { data: receipts = [] } = useQuery({
    queryKey: ['receipts'],
    queryFn: () => base44.entities.Receipt.list('-created_date'),
  });

  const { data: folders = [] } = useQuery({
    queryKey: ['folders'],
    queryFn: () => base44.entities.Folder.list('name'),
  });

  // The report reflects the selected folder (document).
  const filteredReceipts = useMemo(() => {
    if (exportFolder === 'all') return receipts;
    if (exportFolder === 'root') return receipts.filter(r => !r.folder_id);
    return receipts.filter(r => r.folder_id === exportFolder);
  }, [receipts, exportFolder]);

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

  // Normalize common country name variants so the breakdown isn't fragmented.
  const normCountry = (c) => {
    const k = (c || '').toLowerCase().replace(/[^a-z]/g, '');
    if (['uk', 'gb', 'gbr', 'unitedkingdom', 'england', 'greatbritain', 'britain', 'scotland', 'wales'].includes(k)) return 'United Kingdom';
    if (['fr', 'fra', 'france'].includes(k)) return 'France';
    return c || 'Unknown';
  };

  // Calculate country breakdown (top 5, rest grouped as "Other")
  const countryData = useMemo(() => {
    const map = {};
    filteredReceipts.forEach(r => {
      const c = normCountry(r.country);
      map[c] = map[c] || { country: c, vat: 0, total: 0, count: 0 };
      map[c].vat += r.vat_amount || 0;
      map[c].total += r.total_amount || 0;
      map[c].count += 1;
    });
    const sorted = Object.values(map).sort((a, b) => b.total - a.total);
    if (sorted.length <= 6) return sorted;
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((a, x) => ({ country: 'Other', vat: a.vat + x.vat, total: a.total + x.total, count: a.count + x.count }), { vat: 0, total: 0, count: 0 });
    return [...top, { country: 'Other', ...rest }];
  }, [filteredReceipts]);

  // Receipt count per folder created in the Dashboard, for the export dropdown.
  const folderCounts = useMemo(() => {
    const counts = {};
    let root = 0;
    receipts.forEach(r => {
      if (r.folder_id) counts[r.folder_id] = (counts[r.folder_id] || 0) + 1;
      else root += 1;
    });
    return { counts, root };
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

  const folderName = (id) => folders.find(f => f.id === id)?.name || 'Folder';

  // Receipts for the selected folder ('all' = everything, 'root' = no folder).
  const isUnchecked = (r) => r.needs_review && !r.is_reviewed;
  const folderSet = () => {
    if (exportFolder === 'all') return receipts;
    if (exportFolder === 'root') return receipts.filter(r => !r.folder_id);
    return receipts.filter(r => r.folder_id === exportFolder);
  };
  const getExportSet = () => folderSet().filter(r => !(skipUnchecked && isUnchecked(r)));
  const uncheckedInScope = folderSet().filter(isUnchecked).length;

  const scopeLabel = () => {
    if (exportFolder === 'all') return 'All folders';
    if (exportFolder === 'root') return 'No folder';
    return folderName(exportFolder);
  };

  const scopeFileTag = () =>
    scopeLabel().replace(/[^a-z0-9]+/gi, '_').toLowerCase().replace(/^_+|_+$/g, '');

  const [isExporting, setIsExporting] = useState(false);

  const runExport = async (fmt) => {
    if (!exportFolder) return;
    setIsExporting(true);

    try {
      const monthReceipts = getExportSet();

      if (monthReceipts.length === 0) {
        alert('No receipts found in the selected folder.');
        return;
      }

      const monthLabel = scopeLabel();

      // Fetch historical EUR->GBP daily rates spanning the receipts (ECB via Frankfurter)
      const spanDates = monthReceipts
        .map(r => (r.receipt_date || r.created_date || '').slice(0, 10))
        .filter(Boolean)
        .sort();
      const monthStart = spanDates[0];
      const monthEnd = spanDates[spanDates.length - 1];
      let rateByDate = {};
      let rateDates = [];
      if (monthStart && monthEnd) {
        try {
          const res = await fetch(`https://api.frankfurter.dev/v1/${monthStart}..${monthEnd}?base=EUR&symbols=GBP`);
          const data = await res.json();
          rateByDate = Object.fromEntries(
            Object.entries(data.rates || {}).map(([d, v]) => [d, v.GBP])
          );
          rateDates = Object.keys(rateByDate).sort();
        } catch (e) {
          console.error('Failed to fetch exchange rates:', e);
        }
      }

      // EUR->GBP rate at or before a date (ECB publishes no weekend/holiday rates)
      const rateForDate = (dateStr) => {
        if (rateDates.length === 0) return null;
        const key = (dateStr || '').slice(0, 10);
        let chosen = rateDates[0];
        for (const d of rateDates) {
          if (d <= key) chosen = d; else break;
        }
        return rateByDate[chosen];
      };

      // Drop only exact-duplicate rows (same file_name = same document + same
      // receipt slot, e.g. an accidental re-upload). We do NOT dedup by content:
      // two genuine tickets can share vendor + date + amount, and collapsing
      // them would undercount the report. Content-duplicate review lives in
      // Admin → Duplicates.
      const seenFileNames = new Set();
      const dedupedReceipts = monthReceipts.filter(r => {
        const fileKey = r.file_name || `id:${r.id}`;
        if (seenFileNames.has(fileKey)) return false;
        seenFileNames.add(fileKey);
        return true;
      });

      // Sort by receipt date, earliest to latest (ISO YYYY-MM-DD sorts lexically).
      const dateKey = (r) => (r.receipt_date || r.created_date || '').slice(0, 10);
      dedupedReceipts.sort((a, b) => dateKey(a).localeCompare(dateKey(b)));

      // Per-receipt figures, converted to GBP at each receipt's date.
      // Single source of truth so every sheet stays consistent.
      const rows = dedupedReceipts.map(r => {
        const total = r.total_amount || 0;
        const vat = r.vat_amount || 0;
        const rate = r.currency === 'EUR' ? rateForDate(r.receipt_date || r.created_date) : null;
        const toGbp = (amount) => (rate != null ? amount * rate : amount);
        return {
          r,
          total,
          vat,
          rate,
          totalGbp: r.currency === 'EUR' ? toGbp(total) : total,
          vatGbp: r.currency === 'EUR' ? toGbp(vat) : vat,
        };
      });

      const n2 = (v) => Math.round((v || 0) * 100) / 100;

      // Summary totals (GBP) — computed from the deduplicated rows.
      const totalAmountGbp = rows.reduce((s, x) => s + x.totalGbp, 0);
      const totalVatGbp = rows.reduce((s, x) => s + x.vatGbp, 0);
      const uniqueVendors = new Set(dedupedReceipts.map(r => r.vendor_name)).size;

      const n = rows.length;

      // VAT % is the effective rate on the receipt. Mixed-rate baskets (e.g. a
      // supermarket with zero-rated food + standard-rated goods) produce odd
      // fractional rates, so round to a whole percent to keep the report tidy.
      const vatRateLabel = (rate) => (rate > 0 ? `${Math.round(rate)}%` : 'none');

      // Classify each receipt into a UK VAT band by its effective rate. We only
      // store one rate per receipt, so a mixed basket lands in "Mixed / other".
      const vatBand = (rate) => {
        const r = rate || 0;
        if (r < 1) return 'Zero (0%)';
        if (r >= 3.5 && r <= 6.5) return 'Reduced (5%)';
        if (r >= 16 && r <= 24) return 'Standard (20%)';
        return 'Mixed / other';
      };
      const BANDS = ['Standard (20%)', 'Reduced (5%)', 'Zero (0%)', 'Mixed / other'];
      const bandTotals = Object.fromEntries(BANDS.map(b => [b, { count: 0, net: 0, vat: 0 }]));
      rows.forEach(x => {
        const b = bandTotals[vatBand(x.r.vat_rate)];
        b.count += 1;
        b.net += x.totalGbp - x.vatGbp;
        b.vat += x.vatGbp;
      });

      // One array per receipt — shared by both the Excel and CSV outputs.
      const receiptRows = rows.map(x => {
        const d = x.r.receipt_date || x.r.created_date;
        return [
          d ? format(new Date(d), 'dd/MM/yyyy') : '',
          x.r.vendor_name || '',
          n2(x.totalGbp),
          vatRateLabel(x.r.vat_rate),
          n2(x.vatGbp),
        ];
      });

      const FX_NOTE = 'GBP figures use ECB EUR→GBP reference rates at each receipt date.';
      const BAND_NOTE = 'Bands are classified by each receipt’s effective VAT rate; mixed-rate baskets fall in “Mixed / other”.';

      if (fmt === 'csv') {
        const esc = (v) => {
          const s = String(v ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const line = (arr) => arr.map(esc).join(',');
        const csvLines = [
          line(['Date', 'Name', 'Amount (GBP)', 'VAT %', 'VAT (GBP)']),
          ...receiptRows.map(line),
          '',
          line(['TOTALS']),
          line(['Total Receipts', n]),
          line(['Total Amount (GBP)', n2(totalAmountGbp)]),
          line(['Total VAT (GBP)', n2(totalVatGbp)]),
          line(['Unique Vendors', uniqueVendors]),
          '',
          line(['VAT BY RATE', 'Receipts', 'Net (GBP)', 'VAT (GBP)']),
          ...BANDS.map(b => line([b, bandTotals[b].count, n2(bandTotals[b].net), n2(bandTotals[b].vat)])),
          '',
          line([BAND_NOTE]),
          line([FX_NOTE]),
        ];
        const blob = new Blob(['﻿' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `vat_report_${scopeFileTag()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      // Styled workbook: a summary sheet (totals + VAT by rate) and the receipts table.
      const wb = await newWorkbook();
      const sub = [`${scopeLabel()} · ${n} receipt${n === 1 ? '' : 's'}`, `Prepared ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} from the PB Abbey app`];
      summarySheet(wb, {
        title: `PB ABBEY LTD — VAT report`,
        subtitle: sub,
        blocks: [
          { heading: 'Totals (GBP)', rows: [
            ['Receipts', n, 'int'],
            ['Unique suppliers', uniqueVendors, 'int'],
            ['Total amount', n2(totalAmountGbp)],
            ['Total VAT', n2(totalVatGbp), 'money', '', true],
          ] },
          { heading: 'VAT by rate', rows: BANDS.map((bnd) => [`${bnd} — ${bandTotals[bnd].count} receipt${bandTotals[bnd].count === 1 ? '' : 's'}`, n2(bandTotals[bnd].vat), 'money', `net £${n2(bandTotals[bnd].net).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`]) },
        ],
        checks: [{ text: BAND_NOTE }, { text: FX_NOTE }],
      });
      tableSheet(wb, {
        sheet: 'Receipts', title: 'Receipts', subtitle: sub,
        columns: [{ header: 'Date', type: 'date', width: 11 }, { header: 'Supplier', width: 32 }, { header: 'Amount £', type: 'money', width: 13, total: 'sum' }, { header: 'VAT %', width: 8 }, { header: 'VAT £', type: 'money', width: 12, total: 'sum' }, { header: 'Net £', type: 'money', width: 13, total: 'sum' }, { header: 'Original', type: 'link', width: 42 }],
        rows: rows.map((x) => [(x.r.receipt_date || x.r.created_date || '').slice(0, 10), x.r.vendor_name || '', n2(x.totalGbp), vatRateLabel(x.r.vat_rate), n2(x.vatGbp), n2(x.totalGbp - x.vatGbp),
          { text: (x.r.file_name || '').replace(/\s*\[\d+\/\d+\]\s*$/, '') || 'Open', url: x.r.file_url }]),
        notes: [FX_NOTE],
      });
      await download(wb, `vat_report_${scopeFileTag()}.xlsx`);
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (value) => `£${(Number(value) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <AppShell title="Reports" subtitle="Generate and export VAT summaries">
      <div className="max-w-full">
        <YearEndPack />
        {/* Document picker + export */}
        <div className="bg-white border border-neutral-200 rounded-lg p-5 mb-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <p className="text-sm font-semibold text-neutral-900">Choose a document to report on</p>
              <p className="text-xs text-neutral-500">Select a folder from your repository, then export.</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button onClick={() => runExport('xlsx')} disabled={isExporting} className="bg-neutral-900 hover:bg-neutral-800 text-white gap-2 disabled:opacity-50">
                <Download className="w-4 h-4" /> {isExporting ? 'Exporting…' : 'Excel'}
              </Button>
              <Button onClick={() => runExport('csv')} disabled={isExporting} variant="outline" className="gap-2 disabled:opacity-50">
                <Download className="w-4 h-4" /> CSV
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {[{ id: 'all', name: 'All documents', n: receipts.length },
              ...folders.map(f => ({ id: f.id, name: f.name, n: folderCounts.counts[f.id] || 0 })),
              ...(folderCounts.root > 0 ? [{ id: 'root', name: 'Unfiled', n: folderCounts.root }] : [])]
              .map(opt => {
                const active = exportFolder === opt.id;
                return (
                  <button key={opt.id} onClick={() => setExportFolder(opt.id)}
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      active ? 'border-brand bg-neutral-50 text-neutral-700 font-medium' : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'}`}>
                    <Folder className={`w-4 h-4 ${active ? 'text-neutral-700' : 'text-neutral-400'}`} />
                    {opt.name}
                    <span className={`text-xs ${active ? 'text-neutral-700/70' : 'text-neutral-400'}`}>{opt.n}</span>
                  </button>
                );
              })}
          </div>
          {uncheckedInScope > 0 && (
            <label className="mt-4 flex items-center gap-2 text-[13px] text-neutral-700 cursor-pointer select-none">
              <input type="checkbox" checked={skipUnchecked} onChange={(e) => setSkipUnchecked(e.target.checked)} className="accent-neutral-900" />
              Leave out the <span className="font-semibold">{uncheckedInScope}</span> receipt{uncheckedInScope !== 1 ? 's' : ''} still to check
              <a href={wsPath('/Review')} className="text-neutral-500 underline ml-1">check them now</a>
            </label>
          )}
          {uncheckedInScope === 0 && <p className="mt-4 text-[12px] text-emerald-700">Every receipt in this selection has been checked.</p>}
        </div>

        {/* Summary — ledger strip */}
        <div className="mb-8">
          <StatStrip items={[
            { label: 'Total spend', value: formatCurrency(summary.totalAmount) },
            { label: 'Total VAT', value: formatCurrency(summary.totalVAT) },
            { label: 'Vendors', value: summary.uniqueVendors },
            { label: 'Countries', value: summary.uniqueCountries },
          ]} />
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
                  <TrendingUp className="w-5 h-5 text-neutral-900" />
                  Monthly VAT Trend
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={monthlyData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e7e2d8" />
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
                        stroke="#404040" 
                        strokeWidth={2}
                        name="VAT"
                        dot={{ fill: "#404040" }}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="total" 
                        stroke="#171717" 
                        strokeWidth={2}
                        name="Total"
                        dot={{ fill: "#171717" }}
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
                  <MapPin className="w-5 h-5 text-neutral-900" />
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
                        innerRadius={55}
                        outerRadius={95}
                        paddingAngle={2}
                        dataKey="total"
                        nameKey="country"
                      >
                        {countryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value) => [formatCurrency(value), 'Spend']}
                        contentStyle={{ borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Legend verticalAlign="middle" align="right" layout="vertical" iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke="#e7e2d8" />
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
                    <Bar dataKey="total" fill="#404040" name="Total" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="vat" fill="#171717" name="VAT" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </AppShell>
  );
}