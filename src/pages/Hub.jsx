/* Hallmark · genre: modern-minimal · macrostructure: Launcher · theme: monochrome-ink
 * tone: utilitarian · anchor hue: navy (sparingly) */
import React from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Building2, LogOut, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const apps = [
  {
    to: '/Dashboard',
    name: 'Receipts & VAT',
    desc: 'Scan and store receipts, and track the VAT paid.',
    icon: Receipt,
  },
  {
    to: '/tenant',
    name: 'Tenant',
    desc: 'Rental properties, tenants and rent due.',
    icon: Building2,
  },
];

export default function Hub() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-background text-slate-800 flex flex-col">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center justify-between">
          <span className="font-semibold text-slate-900">PB Abbey</span>
          <button onClick={() => logout()} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center px-6 py-16">
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900">Applications</h1>
          <p className="text-sm text-slate-500 mt-1 mb-8">Choose an application to open.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {apps.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="group bg-white border border-slate-200 rounded-lg p-6 hover:border-slate-400 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-md border border-slate-200 flex items-center justify-center mb-4">
                    <a.icon className="w-5 h-5 text-slate-700" />
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-slate-700 transition-colors mt-1" />
                </div>
                <h2 className="text-base font-semibold text-slate-900">{a.name}</h2>
                <p className="text-sm text-slate-500 mt-1">{a.desc}</p>
              </Link>
            ))}
          </div>

          <p className="text-xs text-slate-400 mt-10">Signed in as {user?.email}</p>
        </div>
      </main>
    </div>
  );
}
