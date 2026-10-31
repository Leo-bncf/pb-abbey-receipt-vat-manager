/* Outlook-on-the-web frame shared by Mail, Calendar and People: the blue top bar
 * (app launcher, search, quick actions, mailbox avatar), the app rail on the left
 * (bottom tab bar on phones), plus the remembered mailbox (office@ / accounts@) so
 * the three pages open on the same one, and the Fluent-style avatar. */
import React from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Grip, Mail, CalendarDays, Users, Download } from 'lucide-react';

const KEY = 'mail.account';
export const savedAccount = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const saveAccount = (id) => { try { localStorage.setItem(KEY, id); } catch { /* private mode */ } };

const TABS = [
  { to: '/mail', label: 'Mail', icon: Mail, end: true },
  { to: '/mail/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/mail/people', label: 'People', icon: Users },
];

// Fluent persona colours: the same name always gets the same colour.
const PERSONA = [['#e9c7cd', '#a4262c'], ['#f4bfab', '#8f4e00'], ['#f9e2ae', '#835b00'], ['#c9eaf7', '#004e8c'], ['#d4e7d4', '#0b6a0b'], ['#e6bfed', '#5c2e91'],
  ['#c2e7e3', '#005b70'], ['#fed9cc', '#8e562e'], ['#d6d1ee', '#4f52b2'], ['#f1bbbc', '#750b1c'], ['#c7e0f4', '#0f548c'], ['#dbcfe8', '#3b2c8e']];
export const initials = (name) => {
  const s = String(name || '?').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim();
  const w = s.includes('@') ? s.split('@')[0].split(/[._-]+/) : s.split(/\s+/);
  return ((w[0]?.[0] || '?') + (w.length > 1 ? w[w.length - 1][0] || '' : '')).toUpperCase();
};
export function Avatar({ name, size = 32, className = '' }) {
  let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = PERSONA[h % PERSONA.length];
  return (
    <span className={`inline-flex items-center justify-center rounded-full shrink-0 font-semibold select-none ${className}`}
      style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{initials(name)}</span>
  );
}

export default function OutlookFrame({ search, actions, me, children }) {
  const { pathname } = useLocation();
  const app = TABS.find((t) => (t.end ? pathname === t.to : pathname.startsWith(t.to)))?.label || 'Mail';
  return (
    <div className="ol-app h-[100dvh] flex flex-col overflow-hidden">
      <header className="bg-ol-bar text-white shrink-0 h-12 flex items-center gap-1 pr-2 md:pr-3">
        <Link to="/" title="All applications" className="w-12 h-12 flex items-center justify-center hover:bg-white/10 shrink-0"><Grip className="w-5 h-5" /></Link>
        <span className="hidden sm:inline text-[16px] font-semibold tracking-[-0.01em] whitespace-nowrap mr-3">PB Abbey <span className="font-normal opacity-90">{app}</span></span>
        <div className="flex-1 min-w-0 flex justify-center">{search}</div>
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          {actions}
          {typeof window !== 'undefined' && !window.pbDesktop && (
            <Link to="/download" title="Get the desktop app (Mac and Windows)" className="hidden md:inline-flex h-9 px-2.5 rounded-md items-center gap-1.5 text-[13px] hover:bg-white/15">
              <Download className="w-[18px] h-[18px]" /><span className="hidden xl:inline">Desktop app</span>
            </Link>
          )}
          {me && <span title={me.email} className="ml-1.5 rounded-full ring-2 ring-white/30"><Avatar name={me.email} size={30} /></span>}
        </div>
      </header>
      <div className="flex-1 min-h-0 flex">
        <nav className="hidden md:flex w-12 shrink-0 flex-col items-center gap-1 pt-2" aria-label="Apps">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} title={t.label}
              className={({ isActive }) => `relative w-10 h-10 rounded-md flex items-center justify-center ${isActive ? 'bg-white text-ol shadow-sm' : 'text-ol-sub hover:bg-white/70 hover:text-ol'}`}>
              {({ isActive }) => (<>
                {isActive && <span className="absolute -left-1 top-2.5 bottom-2.5 w-[3px] rounded-full bg-ol" />}
                <t.icon className="w-5 h-5" strokeWidth={isActive ? 2.1 : 1.6} />
              </>)}
            </NavLink>
          ))}
        </nav>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">{children}</div>
      </div>
      <nav className="md:hidden shrink-0 h-14 bg-white border-t border-ol-line flex" aria-label="Apps">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-ol font-semibold' : 'text-ol-sub'}`}>
            <t.icon className="w-5 h-5" />{t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// Search box for the blue bar (Outlook's centred search).
export function BarSearch({ value, onChange, onSubmit, onClear, placeholder = 'Search', inputRef, children }) {
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }} className="w-full max-w-[560px] relative">
      <div className="flex items-center gap-2 h-8 px-2.5 rounded-md bg-white/90 focus-within:bg-white text-ol-text">
        <svg viewBox="0 0 20 20" className="w-4 h-4 text-ol shrink-0" fill="currentColor" aria-hidden="true"><path d="M8.5 3a5.5 5.5 0 0 1 4.23 9.02l4.12 4.13a.5.5 0 0 1-.63.76l-.07-.06-4.13-4.12A5.5 5.5 0 1 1 8.5 3Zm0 1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" /></svg>
        <input ref={inputRef} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent text-[14px] outline-none min-w-0 placeholder:text-ol-mute" />
        {value && <button type="button" onClick={onClear} aria-label="Clear search" className="text-ol-sub hover:text-ol-text text-[18px] leading-none px-1">×</button>}
      </div>
      {children}
    </form>
  );
}

// Round white icon button for the blue bar.
export function BarButton({ title, onClick, active, children, className = '' }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className={`h-9 min-w-9 px-2 rounded-md inline-flex items-center justify-center gap-1.5 text-[13px] hover:bg-white/15 ${active ? 'bg-white/20' : ''} ${className}`}>{children}</button>
  );
}

// Office / Accounts switch used on Calendar and People.
export function AccountSwitch({ accounts, value, onChange }) {
  if (accounts.length < 2) return null;
  return (
    <div className="inline-flex p-0.5 rounded-md bg-ol-bg border border-ol-line">
      {accounts.map((a) => (
        <button key={a.id} onClick={() => onChange(a.id)} title={a.email}
          className={`h-7 px-3 rounded text-[13px] ${value === a.id ? 'bg-white text-ol font-semibold shadow-sm' : 'text-ol-sub hover:text-ol-text'}`}>{a.label}</button>
      ))}
    </div>
  );
}
