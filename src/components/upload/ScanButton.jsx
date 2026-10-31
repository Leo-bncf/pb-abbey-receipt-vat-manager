/* "Scan" on the Upload pages: in the PB Abbey desktop app, on the house wifi, one click
 * makes the Epson scan the pages in its top feeder (or the glass, on request) and sends the PDF
 * into the normal reading queue of this app (Receipts & VAT, or Carnas).
 * The scanner itself is not changed: it stays as it is for everyone else.
 * In a plain browser the scanner can't be reached, so only a short hint is shown. */
import React, { useEffect, useState } from 'react';
import { ScanLine, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const desk = () => (typeof window !== 'undefined' ? window.pbDesktop?.scanner : null);

export default function ScanButton({ onScanned, disabled, label }) {
  const api = desk();
  const [found, setFound] = useState(undefined); // undefined = looking, null = not found
  const [duplex, setDuplex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');

  const look = () => { setFound(undefined); api.find().then(setFound).catch(() => setFound(null)); };
  useEffect(() => { if (api) look(); }, []);
  // Keep "pages in the feeder / empty" up to date while the page is open.
  useEffect(() => {
    if (!api || busy) return undefined;
    const t = setInterval(() => { if (!document.hidden) api.find().then((f) => f && setFound(f)).catch(() => {}); }, 5000);
    return () => clearInterval(t);
  }, [api, busy]);

  if (!api) {
    return <p className="mt-3 text-[12px] text-neutral-400">Scanning straight from the Epson works in the PB Abbey desktop app, on the house wifi.</p>;
  }

  const go = async (source) => {
    setErr(''); setBusy(true); setStep('Starting the scanner…');
    try {
      const r = await api.scan({ duplex, source }, setStep);
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', 'h');
      const files = r.docs.map((d, i) => new File([d], `Scan ${stamp}${r.docs.length > 1 ? ` (${i + 1})` : ''}.pdf`, { type: 'application/pdf' }));
      setStep('');
      await onScanned(files);
    } catch (e) {
      setErr(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      setStep('');
    } finally { setBusy(false); look(); }
  };

  return (
    <div className="mt-3 border rule bg-white px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button onClick={() => go('feeder')} disabled={disabled || busy || !found} className="rounded-none gap-2 shrink-0">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />} {label || 'Scan'}
      </Button>
      <div className="min-w-0 flex-1 text-[13px]">
        {busy ? <span className="text-neutral-700">{step}</span>
          : found === undefined ? <span className="text-neutral-400">Looking for the scanner…</span>
          : found === null ? <span className="text-neutral-500">Scanner not found: this computer must be on the house wifi, and the Epson switched on. <button onClick={look} className="underline">Look again</button></span>
          : <span className="text-neutral-600">{found.name} · {/Loaded/i.test(found.adf) ? 'pages in the feeder, ready' : 'feeder empty: put the receipts in the feeder on top'}</span>}
        {err && <p className="text-red-700 mt-1">{err}</p>}
      </div>
      {found && !busy && <button onClick={() => go('glass')} disabled={disabled} className="text-[12px] text-neutral-500 underline shrink-0">Scan the glass instead</button>}
      {found && !busy && <label className="flex items-center gap-1.5 text-[12px] text-neutral-500 shrink-0"><input type="checkbox" checked={duplex} onChange={(e) => setDuplex(e.target.checked)} /> Both sides</label>}
    </div>
  );
}
