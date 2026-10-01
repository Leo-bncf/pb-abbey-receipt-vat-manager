/* Hallmark · genre: modern-minimal · macrostructure: Launcher · theme: ledger-swiss
 * tone: utilitarian · ink + hairlines · motion: cut */
import React from 'react';
import { Link } from 'react-router-dom';
import { LogOut, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const apps = [
  { to: '/Dashboard', name: 'Receipts & VAT', desc: 'Scan and store receipts, and track the VAT paid.' },
  { to: '/tenant', name: 'Tenant', desc: 'Rental properties, tenants and rent due.' },
];

export default function Hub() {
  const { user, logout } = useAuth();
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

      <main className="flex-1 flex flex-col justify-center px-6 py-16">
        <div className="w-full max-w-3xl mx-auto">
          <h1 className="text-[22px] font-semibold tracking-tight">Applications</h1>
          <p className="text-[13px] text-neutral-500 mt-1 mb-8">Select an application.</p>

          {/* Ledger rows — hairline separated, no cards/shadows/icons */}
          <div className="border rule bg-white divide-y divide-neutral-200">
            {apps.map((a) => (
              <Link key={a.to} to={a.to} className="group flex items-center justify-between gap-6 px-6 py-5 hover:bg-neutral-50 transition-colors">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-neutral-900">{a.name}</h2>
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
