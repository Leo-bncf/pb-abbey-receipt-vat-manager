/* "Move to…" dialog: type to find a folder (matches anywhere in its path), or
 * pick from the recently used ones. */
import React, { useState, useEffect, useRef } from 'react';
import { Folder, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export default function MovePicker({ open, onClose, account, folders, current, count, onPick }) {
  const [q, setQ] = useState('');
  const input = useRef(null);
  const key = `mail.recentMoves.${account}`;
  useEffect(() => { if (open) { setQ(''); setTimeout(() => input.current?.focus(), 50); } }, [open]);

  const recent = lsGet(key).map((n) => folders.find((f) => f.name === n)).filter((f) => f && f.name !== current);
  const needle = q.trim().toLowerCase();
  const list = (needle ? folders.filter((f) => f.path.toLowerCase().includes(needle)) : folders).filter((f) => f.name !== current).slice(0, 150);
  const pick = (f) => { lsSet(key, [f.name, ...lsGet(key).filter((n) => n !== f.name)].slice(0, 6)); onPick(f); };

  const item = (f) => (
    <button key={f.name} onClick={() => pick(f)} className="w-full text-left px-3 py-2 hover:bg-ol-hover2 flex items-start gap-2.5">
      <Folder className="w-4 h-4 mt-0.5 text-neutral-400 shrink-0" strokeWidth={1.75} />
      <span className="min-w-0">
        <span className="block text-[13px] truncate">{f.label}</span>
        {f.depth > 0 && <span className="block text-[11px] text-neutral-400 truncate">{f.path.split('/').slice(0, -1).join(' › ')}</span>}
      </span>
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 gap-0 rounded-lg">
        <DialogHeader className="px-4 pt-4 pb-3 border-b rule">
          <DialogTitle className="text-[15px]">Move {count === 1 ? 'message' : `${count} messages`} to…</DialogTitle>
          <div className="mt-2 flex items-center gap-2 h-9 px-2.5 border border-neutral-300 focus-within:border-ol rounded-md">
            <Search className="w-4 h-4 text-neutral-400 shrink-0" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a folder name"
              onKeyDown={(e) => { if (e.key === 'Enter' && list[0]) pick(list[0]); }}
              className="flex-1 bg-transparent text-[14px] outline-none min-w-0" />
          </div>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {!needle && recent.length > 0 && (<>
            <div className="px-3 pt-2 pb-1 text-[12px] font-semibold text-ol-sub">Recent</div>
            {recent.map(item)}
            <div className="px-3 pt-3 pb-1 text-[12px] font-semibold text-ol-sub">All folders</div>
          </>)}
          {list.map(item)}
          {list.length === 0 && <p className="px-4 py-6 text-[13px] text-neutral-400 text-center">No folder matches “{q}”.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
