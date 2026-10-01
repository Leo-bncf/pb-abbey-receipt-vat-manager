/* Hallmark · genre: modern-minimal · macrostructure: Side-rail Workbench · theme: ledger-swiss
 * nav: N3 side-rail · full-bleed content · ink + hairlines + mono figures · motion: cut */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Grid2x2, Upload as UploadIcon, FileBarChart, ShieldCheck, LayoutGrid, Menu, X } from 'lucide-react';

const NAV = [
  { label: 'Receipts', to: '/Dashboard', icon: Grid2x2 },
  { label: 'Upload', to: '/Upload', icon: UploadIcon },
  { label: 'Reports', to: '/Reports', icon: FileBarChart },
  { label: 'Admin', to: '/Admin', icon: ShieldCheck },
];

function Rail({ pathname }) {
  return (
    <nav className="flex flex-col h-full">
      {/* Wordmark */}
      <div className="px-5 h-14 flex items-center border-b rule">
        <div>
          <div className="font-semibold tracking-tight text-neutral-900 leading-none">PB Abbey</div>
          <div className="text-[11px] text-neutral-400 mt-0.5">Receipts &amp; VAT</div>
        </div>
      </div>
      {/* Nav items */}
      <div className="flex-1 py-3">
        {NAV.map((n) => {
          const active = pathname.toLowerCase() === n.to.toLowerCase();
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-2.5 mx-2 px-3 h-9 text-[13px] border-l-2 transition-colors ${
                active
                  ? 'border-neutral-900 bg-white text-neutral-900 font-medium'
                  : 'border-transparent text-neutral-500 hover:text-neutral-900 hover:bg-white/60'
              }`}
            >
              <n.icon className="w-4 h-4" strokeWidth={1.75} />
              {n.label}
            </Link>
          );
        })}
      </div>
      {/* Footer link */}
      <Link to="/" className="px-5 h-12 flex items-center gap-2 text-[12px] text-neutral-400 hover:text-neutral-900 border-t rule transition-colors">
        <LayoutGrid className="w-3.5 h-3.5" /> All applications
      </Link>
    </nav>
  );
}

export default function AppShell({ children, title, subtitle, actions }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-neutral-900 flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col bg-neutral-50 border-r rule sticky top-0 h-screen">
        <Rail pathname={pathname} />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="w-56 bg-neutral-50 border-r rule h-full"><Rail pathname={pathname} /></div>
          <div className="flex-1 bg-black/20" onClick={() => setOpen(false)} />
        </div>
      )}

      {/* Main — full bleed */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <div className="md:hidden h-14 border-b rule flex items-center justify-between px-4">
          <button onClick={() => setOpen(true)} className="text-neutral-700"><Menu className="w-5 h-5" /></button>
          <span className="font-semibold text-sm">PB Abbey</span>
          <Link to="/" className="text-neutral-400"><LayoutGrid className="w-5 h-5" /></Link>
        </div>

        <div className="px-6 md:px-10 py-7 w-full">
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
      </main>
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
