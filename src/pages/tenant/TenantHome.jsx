/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: monochrome-ink · nav: top-bar+back · footer: none
 * tone: utilitarian · anchor hue: navy (used sparingly: active/links/key figures only) */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44 } from '@/api/base44Client';

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

const statusChip = {
  paid: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  part_paid: 'text-amber-700 border-amber-200 bg-amber-50',
  overdue: 'text-red-700 border-red-200 bg-red-50',
  pending: 'text-neutral-600 border-neutral-200 bg-neutral-50',
};

function Kpi({ label, value, accent }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-lg p-5">
      <p className="text-xs font-medium text-neutral-500 mb-2">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight tabular-nums font-fig ${accent ? 'text-red-600' : 'text-neutral-900'}`}>{value}</p>
    </div>
  );
}

const Th = ({ children, right }) => (
  <th className={`px-4 py-2.5 text-xs font-semibold text-neutral-500 ${right ? 'text-right' : 'text-left'}`}>{children}</th>
);

export default function TenantHome() {
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
    return { occupied, monthlyRent, overdueCount: overdue.length, overdueTotal: overdue.reduce((s, p) => s + (Number(p.outstanding) || 0), 0) };
  }, [units, payments]);

  return (
    <div className="min-h-screen bg-background text-neutral-800">
      {/* Top bar */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="font-semibold text-neutral-900">PB Abbey</span>
            <span className="text-neutral-300">/</span>
            <span className="text-sm text-neutral-500">Tenant</span>
          </div>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900 transition-colors">
            <ArrowLeft className="w-4 h-4" /> All apps
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-7">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Tenant</h1>
          <p className="text-sm text-neutral-500 mt-0.5">Rental properties, tenants and rent.</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Kpi label="Units" value={units.length} />
          <Kpi label="Tenants" value={tenants.length} />
          <Kpi label="Monthly rent (net)" value={gbp(stats.monthlyRent)} />
          <Kpi label="Overdue" value={gbp(stats.overdueTotal)} accent={stats.overdueTotal > 0} />
        </div>

        {/* Rent payments */}
        <h2 className="text-sm font-semibold text-neutral-500 mb-3">Rent payments</h2>
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden mb-10">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr><Th>Tenant</Th><Th>Period</Th><Th>Due</Th><Th right>Net</Th><Th right>VAT</Th><Th right>Total</Th><Th>Status</Th><Th></Th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{p.tenant_name}</td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtDate(p.period_start)} → {fmtDate(p.period_end)}</td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtDate(p.due_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-fig">{gbp(p.net_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-fig text-neutral-500">{gbp(p.vat_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-fig font-semibold">{gbp(p.total_amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs border ${statusChip[p.status] || statusChip.pending}`}>{p.status}</span></td>
                    <td className="px-4 py-3 text-right">
                      {p.status !== 'paid' && (
                        <Button size="sm" variant="outline" className="gap-1.5 border-neutral-300" disabled={markPaid.isPending} onClick={() => markPaid.mutate(p)}>
                          {markPaid.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Mark paid
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {payments.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-neutral-400">No rent payments yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* Units & tenants */}
        <h2 className="text-sm font-semibold text-neutral-500 mb-3">Units &amp; tenants</h2>
        <div className="bg-white border border-neutral-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 border-b border-neutral-200">
                <tr><Th>Unit</Th><Th>Address</Th><Th>Tenant</Th><Th right>Rent</Th><Th>Status</Th></tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {units.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{u.reference}</td>
                    <td className="px-4 py-3 text-neutral-500">{u.address}</td>
                    <td className="px-4 py-3 text-neutral-600">{u.tenant_name || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-fig">{gbp(u.rent_amount)}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs border ${u.status === 'occupied' ? statusChip.paid : statusChip.pending}`}>{u.status}</span></td>
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
