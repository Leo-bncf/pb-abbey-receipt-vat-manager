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
    <div className="min-h-screen bg-background text-neutral-900 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">PB Abbey Ltd</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">Sign in</h1>
        </div>
        <form onSubmit={submit} className="bg-white border rule p-6">
          <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1.5">Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mb-4 h-10" />
          <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1.5">Password</label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-4 h-10" />
          {authError && <p className="text-sm text-red-600 mb-4">{authError}</p>}
          <Button type="submit" disabled={busy} className="w-full h-10 bg-neutral-900 hover:bg-neutral-800 gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
