/* The dashboard kit for the Tenant pages. One rule for colour: grey for the facts,
 * green when something is fine, amber/red only for what needs acting on. Every tile
 * = a label, one big figure, one small picture, and at most a few words of action. */
import React from 'react';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

export const TONE = { red: '#b91c1c', amber: '#b45309', green: '#15803d', ink: '#171717', mid: '#737373', soft: '#d4d4d4', faint: '#ececec' };
export const gbpK = (n) => { const v = Number(n) || 0; return Math.abs(v) >= 1000 ? `£${(v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1)}k` : `£${Math.round(v)}`; };
export const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

// A tile: label, big value, a picture, and an optional action chip (link).
export function Tile({ label, value, sub, tone, action, to, children, wide }) {
  const color = tone ? TONE[tone] : TONE.ink;
  const chip = action && (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: tone && tone !== 'green' ? color : TONE.mid }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone ? color : TONE.soft }} />{action}
    </span>
  );
  return (
    <div className={`bg-white p-4 flex flex-col gap-3 min-w-0 ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 truncate">{label}</p>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[26px] leading-none font-fig font-medium tracking-tight" style={{ color: tone === 'red' || tone === 'amber' ? color : TONE.ink }}>{value}</span>
        {sub && <span className="text-[12px] text-neutral-500 truncate">{sub}</span>}
      </div>
      {children && <div className="min-w-0">{children}</div>}
      {chip && (to ? <Link to={to} className="mt-auto hover:underline">{chip}</Link> : <div className="mt-auto">{chip}</div>)}
    </div>
  );
}

// Tiles in a grid with hairline gaps.
export const TileGrid = ({ children, cols = 4 }) => (
  <div className={`grid grid-cols-1 sm:grid-cols-2 ${cols >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-px bg-neutral-200 border border-neutral-200`}>{children}</div>
);

// Progress towards a target: filled bar, optional target tick.
export function Meter({ value, max, target, tone, left, right }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / (Number(max) || 1)) * 100));
  const tpct = target != null ? Math.max(0, Math.min(100, (target / (max || 1)) * 100)) : null;
  return (
    <div>
      <div className="relative h-2 rounded-full" style={{ background: TONE.faint }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: tone ? TONE[tone] : TONE.ink }} />
        {tpct != null && <div className="absolute -top-1 -bottom-1 w-px" style={{ left: `${tpct}%`, background: TONE.mid }} />}
      </div>
      {(left || right) && <div className="mt-1 flex justify-between text-[11px] text-neutral-500 font-fig"><span>{left}</span><span>{right}</span></div>}
    </div>
  );
}

// One bar split into parts (shares of a whole) + a compact legend.
export function Split({ parts, format = gbpK }) {
  const total = parts.reduce((s, p) => s + (Number(p.value) || 0), 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden" style={{ background: TONE.faint }}>
        {parts.map((p) => <div key={p.label} title={`${p.label}: ${format(p.value)}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-600">
        {parts.map((p) => <span key={p.label} className="inline-flex items-center gap-1 min-w-0"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: p.color }} /><span className="truncate">{p.label}</span><span className="font-fig text-neutral-400">{Math.round((p.value / total) * 100)}%</span></span>)}
      </div>
    </div>
  );
}

// Small ring with the share in the middle.
export function Ring({ value, total, tone, size = 64 }) {
  const data = [{ v: Number(value) || 0 }, { v: Math.max(0, (Number(total) || 0) - (Number(value) || 0)) }];
  return (
    <div style={{ width: size, height: size }} className="relative shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart><Pie data={data} dataKey="v" innerRadius="70%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
          <Cell fill={tone ? TONE[tone] : TONE.ink} /><Cell fill={TONE.faint} />
        </Pie></PieChart>
      </ResponsiveContainer>
      <span className="absolute inset-0 flex items-center justify-center text-[12px] font-fig font-medium">{Math.round(((Number(value) || 0) / (Number(total) || 1)) * 100)}%</span>
    </div>
  );
}

// Tiny vertical bars (e.g. rent expiring per year). Highlights bars in `hot`.
export function MiniBars({ data, hot = () => false, height = 70, format = gbpK }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="label" tick={{ fill: TONE.mid, fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
          <YAxis hide />
          <Tooltip formatter={(v) => format(v)} cursor={{ fill: '#f5f5f5' }} contentStyle={{ fontSize: 12 }} />
          <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => <Cell key={i} fill={hot(d) ? TONE.amber : TONE.soft} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Ranked horizontal bars (label · bar · value).
export function Ranked({ rows, format = gbpK, color = TONE.soft, max }) {
  const top = max || Math.max(...rows.map((r) => Number(r.value) || 0), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12px]">
          <span className="truncate text-neutral-600">{r.label}</span>
          <span className="h-2 rounded-sm" style={{ width: `${Math.max(2, (r.value / top) * 100)}%`, background: r.color || color }} />
          <span className="font-fig text-neutral-500">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}
