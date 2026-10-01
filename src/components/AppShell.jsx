import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

// Shared premium frame for the Receipts & VAT app — matches Hallmark:
// ink header with a brass hairline + serif wordmark, then horizontal tabs.
const TABS = [
  { label: 'Receipts', to: '/Dashboard' },
  { label: 'Upload', to: '/Upload' },
  { label: 'Reports', to: '/Reports' },
  { label: 'Admin', to: '/Admin' },
];

export default function AppShell({ children, title, subtitle, actions }) {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-background text-stone-900">
      {/* Ink header */}
      <div className="bg-stone-950 text-white">
        <div className="max-w-6xl mx-auto px-6 pt-6">
          <div className="flex items-end justify-between">
            <div>
              <div className="h-px w-10 bg-brand mb-4" />
              <h1 className="font-display text-3xl font-semibold tracking-tight">Receipts &amp; VAT</h1>
              <p className="text-xs tracking-[0.2em] uppercase text-white/40 mt-1">PB Abbey</p>
            </div>
            <Link to="/" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors mb-1">
              <ArrowLeft className="w-4 h-4" /> Hub
            </Link>
          </div>
          {/* Tabs */}
          <nav className="flex gap-1 mt-6 -mb-px">
            {TABS.map((t) => {
              const active = pathname.toLowerCase() === t.to.toLowerCase();
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={`px-4 py-3 text-sm border-b-2 transition-colors ${
                    active
                      ? 'border-brand text-white'
                      : 'border-transparent text-white/50 hover:text-white/80'
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Page header + content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {(title || actions) && (
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
            <div>
              {title && <h2 className="font-display text-2xl font-semibold text-stone-900">{title}</h2>}
              {subtitle && <p className="text-stone-500 mt-1">{subtitle}</p>}
            </div>
            {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// Premium stat tile (serif figure, hairline border, uppercase label).
export function StatTile({ label, value, sub, accent }) {
  return (
    <div className="bg-white border border-stone-900/10 rounded-xl p-6">
      <p className="text-[11px] uppercase tracking-[0.15em] text-stone-400 mb-3">{label}</p>
      <p className={`font-display text-3xl font-semibold ${accent ? 'text-red-600' : 'text-stone-900'}`}>{value}</p>
      {sub && <p className="text-xs text-stone-400 mt-1">{sub}</p>}
    </div>
  );
}
