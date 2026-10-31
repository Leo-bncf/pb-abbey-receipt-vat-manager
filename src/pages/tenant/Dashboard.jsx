/* Tenant · Overview dashboard — money charts, a business model canvas filled in
 * from the live data (each block ends with what to do about it), and the most
 * valuable actions. Everything is computed when the page opens, so it is always
 * up to date with Rent, Bank, Units, receipts and Actions. */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { ArrowRight } from 'lucide-react';
import { base44, supabase } from '@/api/base44Client';
import { Tile, TileGrid, Meter, Split, Ring, MiniBars, Ranked, TONE, gbpK } from './viz';

const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;
const k = (n) => (Math.abs(n) >= 1000 ? `£${(n / 1000).toFixed(Math.abs(n) >= 100000 ? 0 : 1)}k` : `£${Math.round(n)}`);
const ym = (d) => String(d || '').slice(0, 7);
const C = { billed: '#a3a3a3', received: '#15803d', costs: '#c2410c', margin: '#171717', grid: '#e5e5e5', axis: '#737373' };

// Year-end figures from the filed accounts (Webb & Co, years to 30 June).
const HISTORY = [
  { year: '2022/23', income: 254375, costs: 203562, note: 'land remediation £94k' },
  { year: '2023/24', income: 278489, costs: 150391 },
];
const SEGMENT = (site) => (/southernhay/i.test(site || '') ? 'Offices (Exeter)' : /ambulance/i.test(site || '') ? 'Public sector (NHS)' : 'Industrial & trade');

export default function Dashboard() {
  const since = (() => { const d = new Date(); d.setMonth(d.getMonth() - 11, 1); return d.toISOString().slice(0, 10); })();
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const { data: tenants = [] } = useQuery({ queryKey: ['tenants'], queryFn: () => base44.entities.Tenant.list('name') });
  const { data: payments = [] } = useQuery({ queryKey: ['rent_payments'], queryFn: () => base44.entities.RentPayment.list('-due_date', 5000) });
  const { data: actions = [] } = useQuery({ queryKey: ['actions-all'], queryFn: () => base44.entities.Action.list('-updated_date', 2000) });
  const { data: receipts = [] } = useQuery({ queryKey: ['dash-receipts', since], queryFn: async () => { const { data, error } = await supabase.from('receipts').select('receipt_date,total_amount,vat_amount,currency,vendor_name').eq('workspace', 'pbabbey').gte('receipt_date', since).limit(5000); if (error) throw error; return data; } });
  const { data: sc = [] } = useQuery({ queryKey: ['sc_costs'], queryFn: async () => { const { data, error } = await supabase.from('sc_costs').select('*'); if (error) throw error; return data; } });
  const { data: budgets = [] } = useQuery({ queryKey: ['sc_budgets'], queryFn: async () => { const { data, error } = await supabase.from('sc_budgets').select('*'); if (error) throw error; return data; } });
  const { data: enquiries = [] } = useQuery({ queryKey: ['enquiries'], queryFn: async () => { const { data, error } = await supabase.from('enquiries').select('id,status,created_date'); if (error) throw error; return data; } });
  const { data: bankAcc = [] } = useQuery({ queryKey: ['bank_accounts'], queryFn: async () => { const { data, error } = await supabase.from('bank_accounts').select('*').eq('active', true); if (error) throw error; return data; } });

  const d = useMemo(() => {
    // ---- monthly money, last 12 months
    const months = Array.from({ length: 12 }, (_, i) => { const x = new Date(); x.setMonth(x.getMonth() - 11 + i, 1); return x.toISOString().slice(0, 7); });
    const scCosts = sc.filter((c) => c.status !== 'excluded');
    const scKeys = new Set(scCosts.map((c) => `${c.cost_date}|${Math.round(c.net)}`));
    const rows = months.map((m) => {
      const billed = payments.filter((p) => ym(p.due_date) === m).reduce((s, p) => s + (Number(p.net_amount) || 0), 0);
      const received = payments.filter((p) => ym(p.payment_date) === m).reduce((s, p) => s + (Number(p.amount_paid) || 0) / 1.2, 0);
      const rc = receipts.filter((r) => ym(r.receipt_date) === m && (r.currency || 'GBP') === 'GBP')
        .map((r) => ({ d: r.receipt_date, net: (Number(r.total_amount) || 0) - (Number(r.vat_amount) || 0) }))
        .filter((r) => !scKeys.has(`${r.d}|${Math.round(r.net)}`)).reduce((s, r) => s + r.net, 0);
      const scm = scCosts.filter((c) => ym(c.cost_date) === m).reduce((s, c) => s + (Number(c.net) || 0), 0);
      const costs = rc + scm;
      return { m: new Date(`${m}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short' }), billed: Math.round(billed), received: Math.round(received), costs: Math.round(costs), margin: Math.round(billed - costs) };
    });
    // start where rent has been recorded every month since (the app's rent ledger starts July 2026)
    let firstData = rows.length - 1; while (firstData > 0 && rows[firstData - 1].billed > 0) firstData--;
    if (!rows[firstData]?.billed) firstData = rows.findIndex((r) => r.billed || r.costs);

    // ---- portfolio
    const let_ = units.filter((u) => u.tenant_id);
    const lettable = units.filter((u) => !/yard/i.test(u.reference || ''));
    const empty = lettable.filter((u) => !u.tenant_id);
    const rentYear = let_.reduce((s, u) => s + (Number(u.rent_amount) || 0) * 12, 0);
    const marketYear = lettable.reduce((s, u) => s + Math.max((Number(u.rent_amount) || 0) * 12, Number(u.market_rent) || 0), 0);
    const bySeg = {}; for (const u of let_) { const g = SEGMENT(u.site); bySeg[g] = (bySeg[g] || 0) + (Number(u.rent_amount) || 0) * 12; }
    const bySite = {}; for (const u of let_) bySite[u.site || '—'] = (bySite[u.site || '—'] || 0) + (Number(u.rent_amount) || 0) * 12;
    const byTenant = {}; for (const u of let_) byTenant[u.tenant_name] = (byTenant[u.tenant_name] || 0) + (Number(u.rent_amount) || 0) * 12;
    const top = Object.entries(byTenant).sort((a, b) => b[1] - a[1])[0] || ['—', 0];
    const area = lettable.reduce((s, u) => s + (Number(u.area_sqft) || 0), 0);
    // WAULT: rent-weighted years left to the first exit (break or end)
    const now = new Date(); let wRent = 0; let wYears = 0; let noDate = 0;
    for (const u of let_) {
      const exits = [u.break_date, u.lease_end].filter(Boolean).map((x) => new Date(`${x}T12:00:00`)).filter((x) => x > now);
      const r = (Number(u.rent_amount) || 0) * 12;
      if (!u.lease_end) { noDate++; continue; }
      const yrs = exits.length ? (Math.min(...exits) - now) / (365.25 * 86400000) : 0;
      wRent += r; wYears += r * yrs;
    }
    const wault = wRent ? wYears / wRent : 0;
    // rent reaching its first exit (break or end), by year; holding over counts as now
    const ey = {}; const soonDate = new Date(now.getTime() + 365 * 86400000); let expiring12 = 0;
    for (const u of let_) {
      const r = (Number(u.rent_amount) || 0) * 12; const exits = [u.break_date, u.lease_end].filter(Boolean).map((x) => new Date(`${x}T12:00:00`));
      if (!exits.length) continue;
      const fut = exits.filter((x) => x > now); const first = fut.length ? new Date(Math.min(...fut)) : now;
      const y = first <= now ? 'now' : String(first.getFullYear()); ey[y] = (ey[y] || 0) + r; if (first <= soonDate) expiring12 += r;
    }
    const thisY = now.getFullYear();
    const expiryYears = ['now', ...Array.from({ length: 6 }, (_, i) => String(thisY + i))].map((y) => ({ label: y === 'now' ? 'over' : `'${y.slice(2)}`, value: Math.round(ey[y] || 0), soon: y === 'now' || Number(y) <= thisY + 1 }));
    const tenantSorted = Object.entries(byTenant).sort((a, b) => b[1] - a[1]);
    const tenantParts = [...tenantSorted.slice(0, 3).map(([n, v], i) => ({ label: n.replace(/ (Ltd|Limited|LLP|UK Ltd)$/i, ''), value: v, color: i === 0 && v / (rentYear || 1) > 0.25 ? '#b45309' : ['#404040', '#8a8a8a', '#b5b5b5'][i] })),
      { label: 'Others', value: tenantSorted.slice(3).reduce((s2, [, v]) => s2 + v, 0), color: '#e2e2e2' }];
    const od = {}; for (const p of payments) if (Number(p.outstanding) > 0.005 && p.status !== 'paid' && p.due_date && p.due_date < new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)) od[p.tenant_name] = (od[p.tenant_name] || 0) + Number(p.outstanding);
    const overdueBy = Object.entries(od).sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label: label.replace(/ (Ltd|Limited|LLP|UK Ltd|NHS Foundation Trust)$/i, ''), value }));
    const overdueTotal = overdueBy.reduce((s2, r) => s2 + r.value, 0);
    const holdingOver = let_.filter((u) => u.lease_end && new Date(`${u.lease_end}T12:00:00`) < now);
    // service charge
    const bud = Number(budgets.find((b) => b.year === now.getFullYear())?.budget || budgets[0]?.budget || 0);
    const scUnits = units.filter((u) => Number(u.sc_share) > 0);
    const scByTenants = scUnits.filter((u) => u.tenant_id && !u.sc_included).reduce((s, u) => s + bud * u.sc_share / 100, 0);
    const scByPba = bud - scByTenants;
    const scEmpty = scUnits.filter((u) => !u.tenant_id).reduce((s2, u) => s2 + bud * u.sc_share / 100, 0);
    const scIncluded = scByPba - scEmpty;
    // costs by category and supplier
    const byCat = {}; for (const c of scCosts) byCat[c.category || 'Other'] = (byCat[c.category || 'Other'] || 0) + Number(c.net || 0);
    const bySup = {}; for (const c of scCosts) bySup[c.supplier || '—'] = (bySup[c.supplier || '—'] || 0) + Number(c.net || 0);
    // actions
    const open = actions.filter((a) => a.status === 'open');
    const owed = open.filter((a) => a.amount_kind === 'owed').reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const gain = open.filter((a) => a.amount_kind === 'year' && !a.data?.at_risk).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const best = open.filter((a) => Number(a.amount) > 0).sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0)).slice(0, 5);
    const mails = open.filter((a) => a.kind === 'mail').length;
    const withContact = tenants.filter((t) => t.status !== 'ended' && (t.email || t.phone)).length;
    const current = tenants.filter((t) => t.status !== 'ended').length;
    const history = [...HISTORY.map((h) => ({ ...h, margin: h.income - h.costs })),
      { year: 'Now (rent roll)', income: Math.round(rentYear), costs: null, margin: null },
      { year: 'Fully let', income: Math.round(marketYear), costs: null, margin: null }];
    return { rows: firstData > 0 ? rows.slice(Math.max(0, firstData - 1)) : rows, history, let_, lettable, empty, rentYear, marketYear, bySeg, bySite, top, area, wault, noDate, holdingOver,
      bud, scByTenants, scByPba, scEmpty, scIncluded, expiring12, expiryYears, tenantParts, overdueBy, overdueTotal, byCat, bySup, open, owed, gain, best, mails, withContact, current };
  }, [units, tenants, payments, actions, receipts, sc, budgets]);

  const occ = d.lettable.length ? d.let_.length / d.lettable.length : 0;
  const topShare = d.rentYear ? d.top[1] / d.rentYear : 0;
  const scRec = d.bud ? d.scByTenants / d.bud : 0;
  const newEnq = enquiries.filter((e) => e.status === 'new').length;
  const listed = units.filter((u) => !u.tenant_id && u.listed).length;
  const tick = { fill: C.axis, fontSize: 11 };

  return (
    <div className="flex flex-col gap-8 mb-10">
      {/* Charts */}
      <div className="grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4">
        <section className="bg-white border rule p-4 min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500">Month by month (excl. VAT)</h2>
            <p className="text-[11px] text-neutral-400">Rent from the Rent page, costs from receipts and service charge costs</p>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={d.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="m" tick={tick} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={k} tick={tick} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v) => gbp0(v)} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="billed" name="Rent billed" fill={C.billed} radius={[2, 2, 0, 0]} />
                <Bar dataKey="received" name="Rent received" fill={C.received} radius={[2, 2, 0, 0]} />
                <Bar dataKey="costs" name="Costs" fill={C.costs} radius={[2, 2, 0, 0]} />
                <Line dataKey="margin" name="Billed − costs" stroke={C.margin} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">Rent is recorded in the app from July 2026; payments after 30 Sept 2026 appear once the bank is connected or they are entered.</p>
        </section>
        <section className="bg-white border rule p-4 min-w-0">
          <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500 mb-2">Year by year</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.history} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="year" tick={{ ...tick, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis tickFormatter={k} tick={tick} axisLine={false} tickLine={false} width={52} />
                <Tooltip formatter={(v) => (v == null ? '—' : gbp0(v))} contentStyle={{ fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill={C.received} radius={[2, 2, 0, 0]} />
                <Bar dataKey="costs" name="Costs" fill={C.costs} radius={[2, 2, 0, 0]} />
                <Bar dataKey="margin" name="Profit before tax" fill={C.margin} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">2022/23 and 2023/24 from the filed accounts. “Now” is the rent of every let unit for a year; “Fully let” adds the empty units and market rents.</p>
        </section>
      </div>

      {/* Business health: one picture per question */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500">Business health</h2>
          <p className="text-[11px] text-neutral-400">Live from the data</p>
        </div>
        <TileGrid>
          <Tile label="Units let" value={`${Math.round(occ * 100)}%`} sub={`${d.let_.length} of ${d.lettable.length}`} tone={occ < 0.95 ? 'amber' : 'green'}
            action={d.empty.length ? `Let ${d.empty.length} empty unit${d.empty.length > 1 ? 's' : ''}` : 'All let'} to="/tenant/to-let">
            <Ring value={d.let_.length} total={d.lettable.length} tone={occ < 0.95 ? 'amber' : 'green'} />
          </Tile>
          <Tile label="Rent vs potential" value={gbpK(d.rentYear)} sub={`of ${gbpK(d.marketYear)}`} tone={d.marketYear - d.rentYear > 20000 ? 'amber' : 'green'}
            action={`+${gbpK(d.marketYear - d.rentYear)} a year to win`} to="/tenant/actions">
            <Meter value={d.rentYear} max={d.marketYear} tone={d.marketYear - d.rentYear > 20000 ? 'amber' : 'green'} left="now" right="fully let, market rent" />
          </Tile>
          <Tile label="Biggest tenant" value={`${Math.round(topShare * 100)}%`} sub={d.top[0]} tone={topShare > 0.25 ? 'amber' : 'green'}
            action={topShare > 0.25 ? 'Secure this lease early' : 'Well spread'} to="/tenant/units">
            <Split parts={d.tenantParts} />
          </Tile>
          <Tile label="Lease length left" value={`${d.wault.toFixed(1)} yrs`} sub="average, to first exit" tone={d.wault < 3 ? 'amber' : 'green'}
            action={d.wault < 3 ? 'Aim for longer leases' : 'Healthy'}>
            <Meter value={d.wault} max={10} target={5} tone={d.wault < 3 ? 'amber' : 'green'} left="0" right="target 5 yrs · 10" />
          </Tile>
          <Tile label="Rent up for renewal" value={gbpK(d.expiring12)} sub="within 12 months" tone={d.expiring12 > 0 ? 'amber' : 'green'}
            action={d.expiring12 > 0 ? 'Start renewal talks' : 'Nothing soon'} to="/tenant/actions">
            <MiniBars data={d.expiryYears} hot={(x) => x.soon} />
          </Tile>
          <Tile label="Service charge recovered" value={`${Math.round(scRec * 100)}%`} sub={`PB Abbey pays ${gbpK(d.scByPba)}/yr`} tone={scRec < 0.9 ? 'red' : 'green'}
            action={scRec < 0.9 ? 'Let empties, end “included”' : 'Recovered'} to="/tenant/service-charge">
            <Split parts={[{ label: 'Tenants', value: d.scByTenants, color: TONE.soft }, { label: 'Empty units', value: d.scEmpty, color: TONE.red }, { label: 'In the rent', value: d.scIncluded, color: TONE.amber }]} />
          </Tile>
          <Tile label="Where the rent comes from" value={`${Math.round(((Object.values(d.bySeg).sort((a, b) => b - a)[0] || 0) / (d.rentYear || 1)) * 100)}%`} sub={Object.entries(d.bySeg).sort((a, b) => b[1] - a[1])[0]?.[0]}>
            <Split parts={Object.entries(d.bySeg).sort((a, b) => b[1] - a[1]).map(([g, v], i) => ({ label: g, value: v, color: ['#404040', '#8a8a8a', '#c4c4c4'][i] || '#e5e5e5' }))} />
          </Tile>
          <Tile label="Rent unpaid" value={gbpK(d.overdueTotal)} sub={`${d.overdueBy.length} tenants`} tone={d.overdueTotal > 0 ? 'red' : 'green'}
            action={d.overdueTotal > 0 ? (bankAcc.length ? 'Chase late payers' : 'Check bank, then chase') : 'All paid'} to="/tenant/rent">
            <Ranked rows={d.overdueBy.slice(0, 4)} color={TONE.red} />
          </Tile>
        </TileGrid>
      </section>

      {/* What to do */}
      <section>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-500">What to do first</h2>
          <Link to="/tenant/actions" className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-900">All actions <ArrowRight className="w-3.5 h-3.5" /></Link>
        </div>
        <ol className="bg-white border rule divide-y divide-neutral-200">
          {d.best.map((a, i) => (
            <li key={a.id} className="px-4 py-3 flex items-center gap-4">
              <span className="font-fig text-neutral-400 w-5 shrink-0">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[14px]">{a.title}</span>
              <span className={`font-fig text-[13px] shrink-0 ${a.amount_kind === 'owed' ? 'text-red-700' : 'text-emerald-700'}`}>{a.amount_kind === 'owed' ? `${gbp0(a.amount)} owed` : a.data?.at_risk ? `${gbp0(a.amount)}/yr at risk` : `+${gbp0(a.amount)}/yr`}</span>
            </li>
          ))}
          {!d.best.length && <li className="px-4 py-6 text-[13px] text-neutral-400">Nothing with money attached is open.</li>}
        </ol>
        <p className="mt-2 text-[12px] text-neutral-500 font-fig">Open actions: {gbp0(d.gain)} a year to gain · {gbp0(d.owed)} owed.</p>
      </section>
    </div>
  );
}
