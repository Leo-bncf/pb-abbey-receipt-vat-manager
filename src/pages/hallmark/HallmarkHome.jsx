import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

const statusStyle = {
  paid: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  part_paid: 'text-amber-700 bg-amber-50 border-amber-200',
  overdue: 'text-red-700 bg-red-50 border-red-200',
  pending: 'text-stone-600 bg-stone-100 border-stone-200',
};

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-stone-900/10 rounded-xl p-6">
      <p className="text-[11px] uppercase tracking-[0.15em] text-stone-400 mb-3">{label}</p>
      <p className={`font-display text-3xl font-semibold ${accent ? 'text-red-600' : 'text-stone-900'}`}>{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  );
}

const Th = ({ children, right }) => (
  <th className={`px-6 py-3 text-[11px] uppercase tracking-[0.12em] font-medium text-stone-400 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

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
    <div className="min-h-screen bg-background text-stone-900">
      {/* Ink header */}
      <div className="bg-stone-950 text-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-end justify-between">
          <div>
            <div className="h-px w-10 bg-brand mb-4" />
            <h1 className="font-display text-3xl font-semibold tracking-tight">Hallmark</h1>
            <p className="text-xs tracking-[0.2em] uppercase text-white/40 mt-1">Property Management</p>
          </div>
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="w-4 h-4" /> Hub
          </Link>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <Stat label="Units" value={units.length} sub={`${stats.occupied} occupied`} />
          <Stat label="Tenants" value={tenants.length} />
          <Stat label="Monthly rent (net)" value={gbp(stats.monthlyRent)} />
          <Stat label="Overdue" value={gbp(stats.overdueTotal)} sub={`${stats.overdueCount} payment(s)`} accent={stats.overdueTotal > 0} />
        </div>

        {/* Rent payments */}
        <h2 className="font-display text-xl font-semibold text-stone-900 mb-3">Rent payments</h2>
        <div className="bg-white border border-stone-900/10 rounded-xl overflow-hidden mb-12">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-900/10">
                <tr><Th>Tenant</Th><Th>Period</Th><Th>Due</Th><Th right>Net</Th><Th right>VAT</Th><Th right>Total</Th><Th>Status</Th><Th></Th></tr>
              </thead>
              <tbody className="divide-y divide-stone-900/5">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-stone-50/70">
                    <td className="px-6 py-4 font-medium">{p.tenant_name}</td>
                    <td className="px-6 py-4 text-stone-500">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                    <td className="px-6 py-4 text-stone-500">{fmtDate(p.due_date)}</td>
                    <td className="px-6 py-4 text-right tabular-nums">{gbp(p.net_amount)}</td>
                    <td className="px-6 py-4 text-right tabular-nums text-stone-500">{gbp(p.vat_amount)}</td>
                    <td className="px-6 py-4 text-right tabular-nums font-semibold">{gbp(p.total_amount)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs border ${statusStyle[p.status] || statusStyle.pending}`}>{p.status}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {p.status !== 'paid' && (
                        <Button size="sm" variant="outline" className="gap-1 border-stone-300 hover:bg-stone-900 hover:text-white transition-colors"
                          disabled={markPaid.isPending} onClick={() => markPaid.mutate(p)}>
                          {markPaid.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Mark paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-stone-400">No rent payments yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Units & tenants */}
        <h2 className="font-display text-xl font-semibold text-stone-900 mb-3">Units &amp; tenants</h2>
        <div className="bg-white border border-stone-900/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-900/10">
                <tr><Th>Unit</Th><Th>Address</Th><Th>Tenant</Th><Th right>Rent</Th><Th>Status</Th></tr>
              </thead>
              <tbody className="divide-y divide-stone-900/5">
                {units.map((u) => (
                  <tr key={u.id} className="hover:bg-stone-50/70">
                    <td className="px-6 py-4 font-medium">{u.reference}</td>
                    <td className="px-6 py-4 text-stone-500">{u.address}</td>
                    <td className="px-6 py-4 text-stone-600">{u.tenant_name || '—'}</td>
                    <td className="px-6 py-4 text-right tabular-nums">{gbp(u.rent_amount)}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs border ${u.status === 'occupied' ? statusStyle.paid : statusStyle.pending}`}>{u.status}</span>
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
