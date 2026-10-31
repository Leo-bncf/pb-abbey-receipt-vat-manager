/* Tenant · Overview — KPIs + recent rent, read-only summary. CRUD lives in the
 * Tenants / Units / Rent sections. */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import Dashboard from './Dashboard';
import { StatStrip } from '@/components/AppShell';
import { Th, TableWrap, gbp, fmtDate, rentStatus, leaseEvents, EVENT_CHIP, whenText } from './ui';

const statusChip = {
  paid: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  part_paid: 'text-amber-700 border-amber-200 bg-amber-50',
  overdue: 'text-red-700 border-red-200 bg-red-50',
  pending: 'text-neutral-600 border-neutral-200 bg-neutral-50',
};

export default function TenantHome() {
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date') });
  const { data: certs = [] } = useQuery({ queryKey: ['compliance'], queryFn: () => base44.entities.Compliance.list('expiry_date') });

  const stats = useMemo(() => {
    const monthlyRent = units.reduce((s, u) => s + (Number(u.rent_amount) || 0), 0);
    const overdue = payments.filter((p) => rentStatus(p) === 'overdue');
    const alertCerts = certs.filter((c) => {
      if (!c.expiry_date) return false;
      const d = Math.floor((new Date(c.expiry_date) - new Date()) / 86400000);
      return d <= 60; // expired or expiring within 60 days
    }).length;
    return {
      occupied: units.filter((u) => u.status === 'occupied').length,
      monthlyRent,
      vacant: units.filter((u) => !u.tenant_id && !/yard/i.test(u.reference || '')).length,
      toAct: leaseEvents(units, { months: 12 }).length,
      overdueTotal: overdue.reduce((s, p) => s + (Number(p.outstanding) || 0), 0),
      alertCerts,
    };
  }, [units, payments, certs]);

  const recent = payments.slice(0, 8);
  const { data: openActions = 0 } = useQuery({
    queryKey: ['actions', 'open-count'],
    queryFn: async () => { const { data, error } = await supabase.rpc('refresh_actions'); if (error) throw error; return data || 0; },
  });
  const events = useMemo(() => leaseEvents(units, { months: 18 }), [units]);

  return (
    <TenantShell title="Overview" subtitle="Rental properties, tenants and rent.">
      {openActions > 0 && (
        <Link to="/tenant/actions" className="mb-4 flex items-center justify-between gap-3 px-4 py-3 bg-white border rule border-l-4 border-l-red-600 hover:bg-neutral-50">
          <span className="text-[14px]"><b className="font-semibold">{openActions} things to do</b> across the properties: leases, unpaid rent, empty units.</span>
          <span className="inline-flex items-center gap-1 text-[13px] text-neutral-500 shrink-0">Open Actions <ArrowRight className="w-3.5 h-3.5" /></span>
        </Link>
      )}
      <div className="mb-8">
        <StatStrip items={[
          { label: 'Units', value: units.length, sub: `${stats.occupied} let · ${tenants.filter((t) => t.status !== 'ended').length} tenants` },
          { label: 'Rent a year (net)', value: `£${Math.round(stats.monthlyRent * 12).toLocaleString('en-GB')}`, sub: `${gbp(stats.monthlyRent)} a month` },
          { label: 'Vacant', value: stats.vacant, sub: 'units to let', accent: stats.vacant > 0 },
          { label: 'Lease dates', value: stats.toAct, sub: 'overdue or ≤ 12 months', accent: stats.toAct > 0 },
          { label: 'Overdue', value: gbp(stats.overdueTotal), accent: stats.overdueTotal > 0 },
          { label: 'Certificates to renew', value: stats.alertCerts, sub: 'expired or ≤ 60 days', accent: stats.alertCerts > 0 },
        ]} />
      </div>

      <Dashboard />

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400">Lease dates to act on</h2>
        <Link to="/tenant/units" className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-900">
          All units <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <p className="-mt-1 mb-3 text-[12px] text-neutral-500">Next 18 months. Start talks 12 to 18 months before a lease ends.</p>
      <div className="mb-8">
        <TableWrap>
          <thead className="bg-neutral-50 border-b rule">
            <tr><Th>Date</Th><Th>Unit</Th><Th>Tenant</Th><Th>What</Th><Th right>Rent / year</Th></tr>
          </thead>
          <tbody className="divide-y divide-neutral-200">
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-neutral-50">
                <td className="px-4 py-3 whitespace-nowrap"><span className="font-fig">{fmtDate(e.date)}</span><span className="ml-1.5 text-[11px] text-neutral-400">{whenText(e.days)}</span></td>
                <td className="px-4 py-3 font-medium text-neutral-800">{e.unit.reference}<span className="block text-[11px] font-normal text-neutral-400">{e.unit.site}</span></td>
                <td className="px-4 py-3 text-neutral-600">{e.unit.tenant_name}</td>
                <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs border whitespace-nowrap ${EVENT_CHIP[e.tone]}`}>{e.label}</span>{e.unit.sc_included && <span className="block mt-1 text-[11px] text-amber-700">service charge in rent</span>}</td>
                <td className="px-4 py-3 text-right tabular-nums font-fig">£{Math.round((Number(e.unit.rent_amount) || 0) * 12).toLocaleString('en-GB')}{Number(e.unit.market_rent) > (Number(e.unit.rent_amount) || 0) * 12 + 1 && <span className="block text-[11px] text-amber-700">market £{Math.round(e.unit.market_rent).toLocaleString('en-GB')}</span>}</td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-neutral-400">No lease dates in the next 18 months. Add lease dates on each unit.</td></tr>}
          </tbody>
        </TableWrap>
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400">Recent rent</h2>
        <Link to="/tenant/rent" className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-900">
          View all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <TableWrap>
        <thead className="bg-neutral-50 border-b rule">
          <tr><Th>Tenant</Th><Th>Due</Th><Th right>Total</Th><Th>Status</Th></tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {recent.map((p) => (
            <tr key={p.id} className="hover:bg-neutral-50">
              <td className="px-4 py-3 font-medium text-neutral-800">{p.tenant_name || '—'}</td>
              <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{fmtDate(p.due_date)}</td>
              <td className="px-4 py-3 text-right tabular-nums font-fig font-semibold">{gbp(p.total_amount)}</td>
              <td className="px-4 py-3"><span className={`inline-block px-2 py-0.5 rounded text-xs border ${statusChip[p.status] || statusChip.pending}`}>{p.status}</span></td>
            </tr>
          ))}
          {recent.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-neutral-400">No rent payments yet.</td></tr>}
        </tbody>
      </TableWrap>
    </TenantShell>
  );
}
