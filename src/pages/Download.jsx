/* pbabbey.com/download: the PB Abbey Mail desktop app for Mac and Windows, open without
 * signing in so it can be sent to anyone in the family. The installers live in the
 * public "downloads" storage bucket (built from ~/pb-abbey-desktop, see its package.json).
 * The visitor's computer is detected and its card comes first. */
import React from 'react';
import { Link } from 'react-router-dom';
import { Download as DownloadIcon, Apple, Monitor, Bell, RefreshCw, LogIn, ShieldCheck } from 'lucide-react';

const BASE = 'https://api.pbabbey.com/storage/v1/object/public/downloads';
const VERSION = '1.1.3';
const MAC = { url: `${BASE}/PB-Abbey-Mail.dmg?download=PB%20Abbey%20Mail.dmg&v=${VERSION}`, size: '204 MB' };
const WIN = { url: `${BASE}/PB-Abbey-Mail-Setup.exe?download=PB%20Abbey%20Mail%20Setup.exe&v=${VERSION}`, size: '97 MB' };

const detect = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Windows/i.test(ua)) return 'win';
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac';
  return null;
};

function Card({ kind, mine }) {
  const isMac = kind === 'mac';
  const f = isMac ? MAC : WIN;
  const steps = isMac ? [
    'Open the downloaded file "PB Abbey Mail.dmg".',
    'Drag the PB Abbey Mail icon onto the Applications folder.',
    'Open PB Abbey Mail from Applications. The first time, the Mac says it cannot check the app: click OK.',
    'Open System Settings → Privacy & Security, scroll down and click "Open Anyway", then enter the Mac password.',
    'Sign in with your PB Abbey email and password.',
    'When the Mac asks about notifications, click Allow (needed for new-mail alerts and the unread count).',
    'Tip: right-click the icon in the Dock → Options → Keep in Dock.',
  ] : [
    'Open the downloaded file "PB Abbey Mail Setup.exe".',
    'If a blue window says "Windows protected your PC": click "More info", then "Run anyway".',
    'Follow the installer. A PB Abbey Mail icon appears on the desktop.',
    'Sign in with your PB Abbey email and password.',
    'When you close the window the app keeps running near the clock, so new mail still arrives. Right-click it there to quit.',
  ];
  return (
    <section className={`bg-white rounded-xl p-5 sm:p-6 shadow-[0_0_2px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.12)] ${mine ? 'ring-2 ring-ol' : ''}`}>
      <div className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-lg bg-ol-soft text-ol flex items-center justify-center shrink-0">{isMac ? <Apple className="w-6 h-6" /> : <Monitor className="w-6 h-6" />}</span>
        <div className="min-w-0">
          <h2 className="text-[18px] font-semibold text-ol-text">{isMac ? 'Mac' : 'Windows'}</h2>
          <p className="text-[13px] text-ol-sub">{isMac ? 'Any Mac (Apple chip or Intel)' : 'Windows 10 or 11'} · {f.size}</p>
        </div>
        {mine && <span className="ml-auto shrink-0 h-6 px-2.5 rounded-full bg-ol-soft text-ol text-[12px] font-semibold inline-flex items-center">This computer</span>}
      </div>
      <a href={f.url} className="mt-4 h-11 w-full rounded-md bg-ol hover:bg-ol-hover active:bg-ol-press text-white text-[15px] font-semibold inline-flex items-center justify-center gap-2">
        <DownloadIcon className="w-5 h-5" /> Download for {isMac ? 'Mac' : 'Windows'}
      </a>
      <h3 className="mt-5 text-[14px] font-semibold text-ol-text">Install it (the first time only)</h3>
      <ol className="mt-2 space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-[14px] text-ol-text leading-snug">
            <span className="w-6 h-6 rounded-full bg-ol-bg text-ol-sub text-[12px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Download() {
  const os = detect();
  const order = os === 'win' ? ['win', 'mac'] : ['mac', 'win'];
  return (
    <div className="ol-app min-h-[100dvh]">
      <header className="bg-ol-bar text-white h-12 flex items-center px-4">
        <span className="text-[16px] font-semibold">PB Abbey <span className="font-normal opacity-90">Mail</span></span>
        <Link to="/" className="ml-auto text-[13px] inline-flex items-center gap-1.5 hover:underline"><LogIn className="w-4 h-4" /> Open in the browser</Link>
      </header>
      <main className="max-w-[960px] mx-auto px-4 py-8 sm:py-12">
        <div className="flex items-center gap-4">
          <img src="/pb-abbey-mail-icon.png" alt="" className="w-16 h-16 sm:w-20 sm:h-20 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-[26px] sm:text-[32px] font-semibold text-ol-text tracking-[-0.01em]">PB Abbey Mail for your computer</h1>
            <p className="text-[15px] text-ol-sub mt-1">Mail, calendar and people for office@ and accounts@, plus all the PB Abbey apps, in their own window.</p>
          </div>
        </div>
        <div className="mt-6 grid sm:grid-cols-3 gap-3">
          {[[Bell, 'New-mail alerts', 'A notification for each new email, and the unread count on the icon.'], [RefreshCw, 'Always up to date', 'It shows pbabbey.com, so every improvement arrives by itself.'], [ShieldCheck, 'Same account', 'Sign in once with your PB Abbey email and password.']].map(([I, t, d]) => (
            <div key={t} className="rounded-lg bg-white/70 p-3.5 flex gap-3">
              <I className="w-5 h-5 text-ol shrink-0 mt-0.5" />
              <div><p className="text-[14px] font-semibold text-ol-text">{t}</p><p className="text-[13px] text-ol-sub leading-snug">{d}</p></div>
            </div>
          ))}
        </div>
        <div className="mt-6 grid md:grid-cols-2 gap-4 items-start">
          {order.map((k) => <Card key={k} kind={k} mine={os === k} />)}
        </div>
        <p className="mt-8 text-[12px] text-ol-mute">Version {VERSION}. The warning the first time is normal: the app is made for PB Abbey and not sold in the App Store or Microsoft Store.</p>
      </main>
    </div>
  );
}
