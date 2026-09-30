import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
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
    <div className="min-h-screen grid md:grid-cols-2 bg-background text-stone-900">
      {/* Left: brand panel */}
      <div className="hidden md:flex flex-col justify-between bg-stone-950 text-white p-12">
        <span className="text-xs tracking-[0.25em] uppercase text-white/40">PB Abbey Ltd</span>
        <div>
          <div className="h-px w-12 bg-brand mb-6" />
          <h1 className="font-display text-5xl font-semibold leading-[1.05]">Finance &amp;<br />Property, in<br />one place.</h1>
          <p className="text-white/50 mt-6 max-w-xs">Receipts, VAT and property management for PB Abbey.</p>
        </div>
        <span className="text-xs text-white/30">© {new Date().getFullYear()} · Barnstaple</span>
      </div>

      {/* Right: form */}
      <div className="flex items-center justify-center p-8">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h2 className="font-display text-3xl font-semibold mb-1">Sign in</h2>
          <p className="text-stone-500 mb-8">Welcome back.</p>

          <label className="text-xs uppercase tracking-[0.12em] text-stone-500 block mb-1.5">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mb-5 h-11" />
          <label className="text-xs uppercase tracking-[0.12em] text-stone-500 block mb-1.5">Password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-5 h-11" />
          {authError && <p className="text-sm text-red-600 mb-4">{authError}</p>}
          <Button type="submit" disabled={busy} className="w-full h-11 bg-stone-950 hover:bg-stone-800 gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
