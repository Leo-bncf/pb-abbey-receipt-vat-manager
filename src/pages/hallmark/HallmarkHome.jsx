import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Home, Users, Wallet, AlertTriangle, CheckCircle, ArrowLeft, Building2, Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { base44 } from '@/api/base44Client';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

const statusStyle = {
  paid: 'bg-green-100 text-green-700',
  part_paid: 'bg-amber-100 text-amber-700',
  overdue: 'bg-red-100 text-red-700',
  pending: 'bg-slate-100 text-slate-600',
};

const COLORS = {
  indigo: 'bg-indigo-100 text-indigo-600',
  blue: 'bg-blue-100 text-blue-600',
  emerald: 'bg-emerald-100 text-emerald-600',
  red: 'bg-red-100 text-red-600',
};

function Stat({ icon: Icon, label, value, color = 'indigo', sub }) {
  const c = COLORS[color] || COLORS.indigo;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${c}`}>
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

export default function HallmarkHome() {
  const qc = useQueryClient();
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date') });

  const markPaid = useMutation({
    mutationFn: (p) => base44.entities.RentPayment.update(p.id, {
      status: 'paid', amount_paid: p.total_amount, outstanding: 0,
      payment_date: new Date().toISOString().slice(0, 10),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rent_payments'] }),
  });

  const stats = useMemo(() => {
    const occupied = units.filter((u) => u.status === 'occupied').length;
    const monthlyRent = units.reduce((s, u) => s + (Number(u.rent_amount) || 0), 0);
    const overdue = payments.filter((p) => p.status === 'overdue');
    const overdueTotal = overdue.reduce((s, p) => s + (Number(p.outstanding) || 0), 0);
    return { occupied, monthlyRent, overdueCount: overdue.length, overdueTotal };
  }, [units, payments]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Hallmark header */}
      <div className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-6 py-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center">
              <Home className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">HALLMARK</h1>
              <p className="text-xs text-slate-400">Property Management</p>
            </div>
          </div>
          <Link to="/"><Button variant="ghost" className="text-slate-300 hover:text-white gap-2"><ArrowLeft className="w-4 h-4" /> Hub</Button></Link>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Stat icon={Building2} label="Units" value={units.length} sub={`${stats.occupied} occupied`} color="indigo" />
          <Stat icon={Users} label="Tenants" value={tenants.length} color="blue" />
          <Stat icon={Wallet} label="Monthly rent (net)" value={gbp(stats.monthlyRent)} color="emerald" />
          <Stat icon={AlertTriangle} label="Overdue" value={gbp(stats.overdueTotal)} sub={`${stats.overdueCount} payment(s)`} color={stats.overdueTotal > 0 ? 'red' : 'emerald'} />
        </div>

        {/* Rent payments */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-8">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800">Rent payments</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Tenant</th>
                  <th className="px-6 py-3 text-left font-medium">Period</th>
                  <th className="px-6 py-3 text-left font-medium">Due</th>
                  <th className="px-6 py-3 text-right font-medium">Net</th>
                  <th className="px-6 py-3 text-right font-medium">VAT</th>
                  <th className="px-6 py-3 text-right font-medium">Total</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">{p.tenant_name}</td>
                    <td className="px-6 py-3 text-slate-500">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                    <td className="px-6 py-3 text-slate-500">{fmtDate(p.due_date)}</td>
                    <td className="px-6 py-3 text-right">{gbp(p.net_amount)}</td>
                    <td className="px-6 py-3 text-right">{gbp(p.vat_amount)}</td>
                    <td className="px-6 py-3 text-right font-semibold">{gbp(p.total_amount)}</td>
                    <td className="px-6 py-3"><Badge className={statusStyle[p.status] || statusStyle.pending}>{p.status}</Badge></td>
                    <td className="px-6 py-3 text-right">
                      {p.status !== 'paid' && (
                        <Button size="sm" variant="outline" className="gap-1 text-green-700 border-green-200 hover:bg-green-50"
                          disabled={markPaid.isPending} onClick={() => markPaid.mutate(p)}>
                          {markPaid.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Mark paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={8} className="px-6 py-10 text-center text-slate-400">No rent payments yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Units & tenants */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200">
            <h2 className="font-semibold text-slate-800">Units &amp; tenants</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Unit</th>
                  <th className="px-6 py-3 text-left font-medium">Address</th>
                  <th className="px-6 py-3 text-left font-medium">Tenant</th>
                  <th className="px-6 py-3 text-right font-medium">Rent</th>
                  <th className="px-6 py-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {units.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 font-medium text-slate-800">{u.reference}</td>
                    <td className="px-6 py-3 text-slate-500">{u.address}</td>
                    <td className="px-6 py-3 text-slate-600">{u.tenant_name || '—'}</td>
                    <td className="px-6 py-3 text-right">{gbp(u.rent_amount)}</td>
                    <td className="px-6 py-3">
                      <Badge className={u.status === 'occupied' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}>{u.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
