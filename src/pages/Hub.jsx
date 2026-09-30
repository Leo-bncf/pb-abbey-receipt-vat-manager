import React from 'react';
import { Link } from 'react-router-dom';
import { Receipt, Home, LogOut, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';

const apps = [
  {
    to: '/Dashboard',
    name: 'Receipts & VAT',
    desc: 'Scan receipts, extract VAT, export reports',
    icon: Receipt,
    grad: 'from-indigo-500 to-purple-600',
  },
  {
    to: '/hallmark',
    name: 'Hallmark',
    desc: 'Property management — tenants, units, rent & VAT',
    icon: Home,
    grad: 'from-slate-700 to-slate-900',
  },
];

export default function Hub() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">PB Abbey</h1>
            <p className="text-slate-500">{user?.email}</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={() => logout()}>
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {apps.map((a) => (
            <Link key={a.to} to={a.to} className="group">
              <div className="bg-white rounded-2xl border border-slate-200 p-8 h-full hover:shadow-lg hover:border-slate-300 transition-all">
                <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${a.grad} flex items-center justify-center shadow-lg mb-5`}>
                  <a.icon className="w-7 h-7 text-white" />
                </div>
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-800">{a.name}</h2>
                  <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-slate-600 group-hover:translate-x-1 transition-all" />
                </div>
                <p className="text-slate-500 mt-2">{a.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
