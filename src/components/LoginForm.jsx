import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/AuthContext';

const lbl = 'text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1.5';

function Frame({ title, children }) {
  return (
    <div className="min-h-screen bg-background text-neutral-900 flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400">PB Abbey Ltd</p>
          <h1 className="text-xl font-semibold tracking-tight mt-1">{title}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function LoginForm() {
  const { login, authError, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState('signin'); // signin | reset | sent
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { await login(email.trim(), password); } catch { /* authError shown */ } finally { setBusy(false); }
  };

  const sendReset = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await requestPasswordReset(email.trim()); setMode('sent'); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };

  if (mode === 'sent') {
    return (
      <Frame title="Check your email">
        <div className="bg-white border rule p-6 text-[14px] text-neutral-700">
          <p>If <span className="font-medium">{email}</span> has an account, a link to choose a new password is on its way.</p>
          <button onClick={() => setMode('signin')} className="mt-5 text-[13px] text-neutral-500 underline">Back to sign in</button>
        </div>
      </Frame>
    );
  }

  if (mode === 'reset') {
    return (
      <Frame title="Reset your password">
        <form onSubmit={sendReset} className="bg-white border rule p-6">
          <label className={lbl}>Email</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mb-4 h-10" />
          {err && <p className="text-sm text-red-600 mb-4">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full h-10 bg-neutral-900 hover:bg-neutral-800 gap-2">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Email me a reset link
          </Button>
          <button type="button" onClick={() => setMode('signin')} className="mt-4 text-[13px] text-neutral-500 underline">Back to sign in</button>
        </form>
      </Frame>
    );
  }

  return (
    <Frame title="Sign in">
      <form onSubmit={submit} className="bg-white border rule p-6">
        <label className={lbl}>Email</label>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus className="mb-4 h-10" />
        <label className={lbl}>Password</label>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mb-4 h-10" />
        {authError && <p className="text-sm text-red-600 mb-4">{authError}</p>}
        <Button type="submit" disabled={busy} className="w-full h-10 bg-neutral-900 hover:bg-neutral-800 gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Sign in
        </Button>
        <button type="button" onClick={() => setMode('reset')} className="mt-4 text-[13px] text-neutral-500 underline">Forgot password?</button>
      </form>
    </Frame>
  );
}

// Shown after following an invitation or password-reset link.
export function SetPasswordForm() {
  const { user, setPassword } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (pw.length < 10) return setErr('Use at least 10 characters.');
    if (pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true); setErr(null);
    try { await setPassword(pw); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <Frame title="Choose your password">
      <form onSubmit={submit} className="bg-white border rule p-6">
        {user?.email && <p className="text-[13px] text-neutral-500 mb-4">Welcome, <span className="text-neutral-900 font-medium">{user.email}</span>.</p>}
        <label className={lbl}>New password</label>
        <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus className="mb-4 h-10" autoComplete="new-password" />
        <label className={lbl}>Repeat it</label>
        <Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required className="mb-4 h-10" autoComplete="new-password" />
        {err && <p className="text-sm text-red-600 mb-4">{err}</p>}
        <Button type="submit" disabled={busy} className="w-full h-10 bg-neutral-900 hover:bg-neutral-800 gap-2">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Save and continue
        </Button>
      </form>
    </Frame>
  );
}
