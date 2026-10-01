import React from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Home, LogOut, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';

const apps = [
  {
    to: '/Dashboard',
    name: 'Receipts & VAT',
    desc: 'Scan and store your receipts, and see how much VAT you have paid.',
    icon: Receipt,
  },
  {
    to: '/hallmark',
    name: 'Hallmark',
    desc: 'Manage the rental properties — tenants, units and rent due.',
    icon: Home,
  },
];

export default function Hub() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-brand flex items-center justify-center">
              <Receipt className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-slate-900 text-lg">PB Abbey</span>
          </div>
          <button onClick={() => logout()} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      {/* Welcome */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-3xl">
          <div className="text-center mb-12">
            <h1 className="text-3xl md:text-4xl font-semibold text-slate-900 tracking-tight">Welcome</h1>
            <p className="text-lg text-slate-500 mt-3">What would you like to open?</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {apps.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="group bg-white border-2 border-slate-200 rounded-2xl p-8 text-center hover:border-brand hover:shadow-lg transition-all flex flex-col items-center"
              >
                <div className="w-20 h-20 rounded-2xl bg-brand/10 flex items-center justify-center mb-5 group-hover:bg-brand transition-colors">
                  <a.icon className="w-10 h-10 text-brand group-hover:text-white transition-colors" />
                </div>
                <h2 className="text-2xl font-semibold text-slate-900 mb-2">{a.name}</h2>
                <p className="text-slate-500 leading-relaxed mb-6 flex-1">{a.desc}</p>
                <span className="inline-flex items-center gap-2 bg-brand text-white font-medium px-6 py-3 rounded-xl group-hover:gap-3 transition-all">
                  Open <ArrowRight className="w-5 h-5" />
                </span>
              </Link>
            ))}
          </div>

          <p className="text-center text-sm text-slate-400 mt-12">
            Signed in as {user?.email}
          </p>
        </div>
      </main>
    </div>
  );
}
