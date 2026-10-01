/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: ledger-swiss
 * tone: utilitarian/austere · anchor: ink + hairlines + mono figures · motion: cut */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

const TABS = [
  { label: 'Receipts', to: '/Dashboard' },
  { label: 'Upload', to: '/Upload' },
  { label: 'Reports', to: '/Reports' },
  { label: 'Admin', to: '/Admin' },
];

export default function AppShell({ children, title, subtitle, actions }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-background text-neutral-900">
      {/* Masthead — hairline, no  */}
      <header className="bg-background border-b rule">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-12">
            <Link to="/" className="flex items-center gap-2 group">
              <span className="font-semibold tracking-tight text-neutral-900">PB Abbey</span>
              <span className="text-neutral-300">·</span>
              <span className="text-[13px] text-neutral-500">Receipts &amp; VAT</span>
            </Link>
            <Link to="/" className="inline-flex items-center gap-1 text-[13px] text-neutral-500 hover:text-neutral-900 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" /> Applications
            </Link>
          </div>
          <nav className="flex gap-7 -mb-px">
            {TABS.map((t) => {
              const active = pathname.toLowerCase() === t.to.toLowerCase();
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`py-2 text-[13px] border-b transition-colors ${
                    active ? 'border-neutral-900 text-neutral-900 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-800'
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {(title || actions) && (
          <div className="flex flex-col md:flex-row md:items-baseline justify-between gap-3 mb-7">
            <div>
              {title && <h1 className="text-[22px] font-semibold tracking-tight text-neutral-900">{title}</h1>}
              {subtitle && <p className="text-[13px] text-neutral-500 mt-0.5 font-fig">{subtitle}</p>}
            </div>
            {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// KPI — flat, hairline, label in small-caps, figure in tabular mono.
export function StatTile({ label, value, sub, accent }) {
  return (
    <div className="bg-white border rule p-4">
      <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-400 mb-2">{label}</p>
      <p className={`font-fig text-[22px] font-medium ${accent ? 'text-red-700' : 'text-neutral-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-neutral-400 mt-1 font-fig">{sub}</p>}
    </div>
  );
}
