/* Hallmark · genre: modern-minimal · macrostructure: Launcher · theme: ledger-swiss
 * tone: utilitarian · ink + hairlines · motion: cut
 * Home: "To do" (everything waiting, across the apps) above the app launcher. */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LogOut, ArrowRight, ClipboardCheck, Loader2, PoundSterling, ShieldAlert, Percent, CheckCircle2, Landmark, ListTodo } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { base44 } from '@/api/base44Client';
import { companyDeadlines, daysUntil, vatDeadlines } from '@/lib/company';
import { rentStatus } from '@/pages/tenant/ui';

const apps = [
  { to: '/Dashboard', name: 'Receipts & VAT', desc: 'Scan and store receipts, and track the VAT paid.' },
  { to: '/carnas', name: 'Carnas', desc: 'The house in France being sold: every payment, scanned and listed by date (€).' },
  { to: '/tenant', name: 'Tenant', desc: 'Rental properties, tenants and rent due.' },
  { to: '/mail', name: 'Mail', desc: 'Outlook for office@ and accounts@: mail and folders, calendar, people, automatic replies.' },
  { to: '/company', name: 'Company', desc: 'Agenda of everything to do, with the Outlook calendars; legal deadlines; year-end pack.' },
];

const gbp = (n) => `£${(Number(n) || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const days = (d) => Math.round((new Date(d) - new Date(iso(new Date()))) / 86400000);
const addDaysIso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };

export default function Hub() {
  const { user, logout } = useAuth();
  const q = (key, fn) => useQuery({ queryKey: key, queryFn: fn, staleTime: 30000 });
  const toCheck = q(['receipts', 'review'], () => base44.entities.Receipt.filter({ needs_review: true, is_reviewed: false }, 'file_name', 5000));
  const carnasCheck = q(['receipts', 'review', 'carnas'], () => base44.entities.Receipt.filter({ needs_review: true, is_reviewed: false, workspace: 'carnas' }, 'file_name', 5000));
  const jobs = q(['scan_jobs'], () => base44.entities.ScanJob.list('-created_date', 25));
  const rent = q(['rent_payments'], () => base44.entities.RentPayment.list('-due_date'));
  const certs = q(['compliance'], () => base44.entities.Compliance.list('expiry_date'));
  const vatSaved = q(['vat_quarters'], () => base44.entities.VATQuarter.list('-end_date'));
  const vatSettings = q(['app_settings', 'vat_settings'], () => base44.entities.AppSetting.get('vat_settings').catch(() => null));
  const tasks = q(['company_tasks'], () => base44.entities.CompanyTask.filter({ done: false }, 'due_date', 500));
  const filings = q(['app_settings', 'company_filings'], () => base44.entities.AppSetting.get('company_filings').catch(() => null));

  const items = useMemo(() => {
    const out = [];
    const n = (toCheck.data || []).length;
    if (n) out.push({ to: '/Review', icon: ClipboardCheck, tone: 'amber', title: `${n} receipt${n > 1 ? 's' : ''} to check`, sub: 'The scanner was not sure — a quick look with the photo of each ticket.' });
    const nc = (carnasCheck.data || []).length;
    if (nc) out.push({ to: '/carnas/Review', icon: ClipboardCheck, tone: 'amber', title: `Carnas: ${nc} receipt${nc > 1 ? 's' : ''} to check`, sub: 'House expenses the scanner was not sure about.' });
    const running = (jobs.data || []).filter((j) => j.status === 'queued' || j.status === 'running').length;
    if (running) out.push({ to: '/Upload', icon: Loader2, spin: true, tone: 'blue', title: `${running} document${running > 1 ? 's' : ''} being read`, sub: "We'll email you when it's done." });
    const failed = (jobs.data || []).filter((j) => j.status === 'error' && days(j.created_date) > -7).length;
    if (failed) out.push({ to: '/Upload', icon: ShieldAlert, tone: 'red', title: `${failed} scan${failed > 1 ? 's' : ''} failed`, sub: 'Open Upload to see why and try again.' });
    const overdue = (rent.data || []).filter((p) => rentStatus(p) === 'overdue');
    if (overdue.length) out.push({ to: '/tenant/rent', icon: PoundSterling, tone: 'red', title: `${gbp(overdue.reduce((s, p) => s + (Number(p.outstanding) || 0), 0))} rent overdue`, sub: `${overdue.length} unpaid invoice${overdue.length > 1 ? 's' : ''}: ${[...new Set(overdue.map((p) => p.tenant_name))].slice(0, 3).join(', ')}${overdue.length > 3 ? '…' : ''}` });
    const due = (certs.data || []).filter((c) => c.expiry_date && days(c.expiry_date) <= 60);
    if (due.length) {
      const exp = due.filter((c) => days(c.expiry_date) < 0).length;
      out.push({ to: '/tenant/compliance', icon: ShieldAlert, tone: exp ? 'red' : 'amber', title: `${due.length} certificate${due.length > 1 ? 's' : ''} to renew`, sub: exp ? `${exp} already expired` : 'Expiring within 60 days' });
    }
    // Next VAT return whose quarter has ended and is not filed yet.
    const stagger = vatSettings.data?.value?.stagger || Number(lsGet('vat.stagger', '1'));
    const vat = vatDeadlines(stagger, addDaysIso(-120), addDaysIso(120)).find((v) => v.end < iso(new Date()) && v.deadline >= iso(new Date()) && !(vatSaved.data || []).some((x) => x.quarter_id === v.key && x.status === 'submitted'));
    if (vat) {
      const done = false;
      const left = days(vat.deadline);
      if (!done) out.push({ to: '/VATReturn', icon: Percent, tone: left <= 14 ? 'red' : 'neutral',
        title: `VAT return due ${new Date(vat.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${left} day${left !== 1 ? 's' : ''}`,
        sub: `Quarter ${vat.label}` });
    }
    // Agenda tasks: late, or due in the next 7 days.
    const soon = (tasks.data || []).filter((t) => days(t.due_date) <= 7);
    if (soon.length) {
      const late = soon.filter((t) => days(t.due_date) < 0).length;
      out.push({ to: '/company', icon: ListTodo, tone: late ? 'red' : 'neutral', title: `${soon.length} agenda task${soon.length > 1 ? 's' : ''} ${late ? `(${late} late)` : 'this week'}`,
        sub: soon.slice(0, 3).map((t) => t.title).join(' · ') + (soon.length > 3 ? '…' : '') });
    }
    // Companies House / HMRC deadlines, from 60 days before (and once late).
    companyDeadlines(filings.data?.value?.filed || {}).forEach((d) => {
      const left = daysUntil(d.due);
      if (left > 60) return;
      out.push({ to: '/company', icon: Landmark, tone: left <= 14 ? 'red' : 'amber',
        title: `${d.label} ${left < 0 ? `${-left} day${left === -1 ? '' : 's'} late` : `due ${new Date(d.due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} — ${left} day${left !== 1 ? 's' : ''}`}`,
        sub: `${d.who} · ${d.periodLabel}` });
    });
    return out;
  }, [toCheck.data, jobs.data, rent.data, certs.data, vatSaved.data, filings.data, vatSettings.data, tasks.data, carnasCheck.data]);

  const loading = [toCheck, jobs, rent, certs].some((x) => x.isLoading);
  const tone = { amber: 'text-amber-700', red: 'text-red-700', blue: 'text-blue-700', neutral: 'text-neutral-700' };

  return (
    <div className="min-h-screen bg-background text-neutral-900 flex flex-col">
      <header className="bg-background border-b rule">
        <div className="max-w-3xl mx-auto px-6 h-12 flex items-center justify-between">
          <span className="font-semibold tracking-tight">PB Abbey</span>
          <button onClick={() => logout()} className="inline-flex items-center gap-2 text-[13px] text-neutral-500 hover:text-neutral-900 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 px-6 py-12">
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="text-[22px] font-semibold tracking-tight">To do</h1>
          <p className="text-[13px] text-neutral-500 mt-1 mb-5">What is waiting across PB Abbey.</p>
          <div className="border rule bg-white divide-y divide-neutral-200 mb-12">
            {loading && <p className="px-6 py-5 text-[13px] text-neutral-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Checking…</p>}
            {!loading && items.length === 0 && (
              <p className="px-6 py-5 text-[14px] text-emerald-700 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> All clear — nothing waiting.</p>
            )}
            {!loading && items.map((it) => (
              <Link key={it.title} to={it.to} className="group flex items-center justify-between gap-6 px-6 py-4 hover:bg-neutral-50 transition-colors">
                <div className="flex items-start gap-3 min-w-0">
                  <it.icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone[it.tone]} ${it.spin ? 'animate-spin' : ''}`} />
                  <div className="min-w-0">
                    <p className={`text-[14px] font-semibold ${tone[it.tone]}`}>{it.title}</p>
                    <p className="text-[12px] text-neutral-500 mt-0.5 truncate">{it.sub}</p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-900 transition-colors shrink-0" />
              </Link>
            ))}
          </div>

          <h2 className="text-[22px] font-semibold tracking-tight">Applications</h2>
          <p className="text-[13px] text-neutral-500 mt-1 mb-5">Select an application.</p>
          <div className="border rule bg-white divide-y divide-neutral-200">
            {apps.map((a) => (
              <Link key={a.to} to={a.to} className="group flex items-center justify-between gap-6 px-6 py-5 hover:bg-neutral-50 transition-colors">
                <div className="min-w-0">
                  <h3 className="text-[15px] font-semibold text-neutral-900">{a.name}</h3>
                  <p className="text-[13px] text-neutral-500 mt-0.5">{a.desc}</p>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-900 transition-colors shrink-0" />
              </Link>
            ))}
          </div>

          <p className="text-[11px] text-neutral-400 mt-6 font-fig">Signed in as {user?.email}</p>
        </div>
      </main>
    </div>
  );
}
