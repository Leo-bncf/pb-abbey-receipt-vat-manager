import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Receipt, LayoutGrid } from 'lucide-react';

// Shared professional frame for the Receipts & VAT app — clean accounting look:
// white top bar, navy brand mark, underlined tabs. No serif, no dark header.
const TABS = [
  { label: 'Receipts', to: '/Dashboard' },
  { label: 'Upload', to: '/Upload' },
  { label: 'Reports', to: '/Reports' },
  { label: 'Admin', to: '/Admin' },
];

export default function AppShell({ children, title, subtitle, actions }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-background text-slate-800">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-brand flex items-center justify-center">
                <Receipt className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-slate-900">PB Abbey</span>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-slate-500">Receipts &amp; VAT</span>
            </Link>
            <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
              <LayoutGrid className="w-4 h-4" /> All apps
            </Link>
          </div>
          {/* Tabs */}
          <nav className="flex gap-6 -mb-px">
            {TABS.map((t) => {
              const active = pathname.toLowerCase() === t.to.toLowerCase();
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`py-2.5 text-sm border-b-2 transition-colors ${
                    active ? 'border-brand text-brand font-medium' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Page header + content */}
      <div className="max-w-6xl mx-auto px-6 py-7">
        {(title || actions) && (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              {title && <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>}
              {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
            </div>
            {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// Clean KPI card (white, navy figure, subtle label).
export function StatTile({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm">
      <p className="text-xs font-medium text-slate-500 mb-2">{label}</p>
      <p className={`text-2xl font-semibold tracking-tight tabular-nums ${accent ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}
