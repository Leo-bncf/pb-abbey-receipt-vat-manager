import React from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Home, LogOut, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const apps = [
  {
    to: '/Dashboard',
    name: 'Receipts & VAT',
    desc: 'Scan receipts, extract VAT, export quarterly reports.',
    icon: Receipt,
    n: '01',
  },
  {
    to: '/hallmark',
    name: 'Hallmark',
    desc: 'Property management — tenants, units, rent & VAT.',
    icon: Home,
    n: '02',
  },
];

export default function Hub() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-background text-stone-900">
      <div className="max-w-5xl mx-auto px-6">
        {/* Top bar */}
        <div className="flex items-center justify-between py-6 border-b border-stone-900/10">
          <span className="text-xs tracking-[0.25em] uppercase text-stone-500">PB Abbey Ltd</span>
          <button onClick={() => logout()} className="inline-flex items-center gap-2 text-xs tracking-wide text-stone-500 hover:text-stone-900 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>

        {/* Hero */}
        <div className="pt-20 pb-16">
          <p className="text-sm text-stone-500 mb-4">{user?.email}</p>
          <h1 className="font-display text-6xl md:text-7xl font-semibold leading-[0.95] tracking-tight text-stone-900">
            Good day.
          </h1>
          <p className="mt-5 text-lg text-stone-500 max-w-md">
            Your finance & property suite. Choose a workspace.
          </p>
        </div>

        {/* App list */}
        <div className="border-t border-stone-900/10">
          {apps.map((a) => (
            <Link key={a.to} to={a.to} className="group block border-b border-stone-900/10">
              <div className="flex items-center gap-6 py-8 transition-all group-hover:pl-3">
                <span className="font-display text-sm text-brand w-8">{a.n}</span>
                <div className="w-12 h-12 rounded-full border border-stone-900/15 flex items-center justify-center shrink-0 group-hover:bg-stone-900 group-hover:text-white transition-colors">
                  <a.icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-display text-2xl font-semibold text-stone-900">{a.name}</h2>
                  <p className="text-stone-500 mt-0.5">{a.desc}</p>
                </div>
                <ArrowUpRight className="w-6 h-6 text-stone-300 group-hover:text-stone-900 group-hover:-translate-y-1 group-hover:translate-x-1 transition-all shrink-0" />
              </div>
            </Link>
          ))}
        </div>

        <p className="py-10 text-xs text-stone-400">© {new Date().getFullYear()} PB Abbey Ltd · Barnstaple</p>
      </div>
    </div>
  );
}
