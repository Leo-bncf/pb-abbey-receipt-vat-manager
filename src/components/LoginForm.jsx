import React, { useState } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';

export default function LoginForm() {
  const { login, authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(email.trim(), password); } catch { /* authError shown */ } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg mb-3">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">PB Abbey — VAT Manager</h1>
          <p className="text-sm text-slate-500">Sign in to continue</p>
        </div>
        <label className="text-sm font-medium text-slate-700 block mb-1">Email</label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mb-4" />
        <label className="text-sm font-medium text-slate-700 block mb-1">Password</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-4" />
        {authError && <p className="text-sm text-red-600 mb-4">{authError}</p>}
        <Button type="submit" disabled={busy} className="w-full bg-indigo-600 hover:bg-indigo-700 gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Sign in
        </Button>
      </form>
    </div>
  );
}
