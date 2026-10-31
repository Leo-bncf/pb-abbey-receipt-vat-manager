/* Outlook-style folder pane: Favourites (Inbox, Drafts, Sent, Archive, Deleted,
 * Junk), then the mailbox's whole folder tree. Folders open on click, take
 * messages dropped on them, and have a ⋯ menu (new subfolder, rename, delete).
 * Which branches are open is remembered per mailbox in this browser. */
import React, { useMemo, useState, useEffect } from 'react';
import { Inbox, Send, FileText, Archive, Trash2, ShieldAlert, Folder, FolderOpen, ChevronRight, MoreHorizontal, FolderPlus, Pencil, Search, X } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const SPECIAL = {
  inbox: { label: 'Inbox', icon: Inbox, order: 0, prefer: /^inbox$/i },
  drafts: { label: 'Drafts', icon: FileText, order: 1, prefer: /^drafts$/i },
  sent: { label: 'Sent', icon: Send, order: 2, prefer: /^sent items$/i },
  archive: { label: 'Archive', icon: Archive, order: 3, prefer: /^archive$/i },
  trash: { label: 'Deleted', icon: Trash2, order: 4, prefer: /^deleted items$/i },
  junk: { label: 'Junk', icon: ShieldAlert, order: 5, prefer: /^junk e-?mail$/i },
};
const FLAG = { drafts: /\\Drafts/i, sent: /\\Sent/i, trash: /\\Trash/i, junk: /\\Junk/i, archive: /\\Archive/i };

// One folder per special use (Exchange often has both an English and a French copy):
// the one the server flags, else the English Exchange name, else the fullest.
export function pickFavourites(folders, counts = {}) {
  const out = {};
  Object.keys(SPECIAL).forEach((k) => {
    const c = folders.filter((f) => f.special === k);
    if (!c.length) return;
    out[k] = (FLAG[k] && c.find((f) => FLAG[k].test(f.flags))) || c.find((f) => SPECIAL[k].prefer.test(f.path)) || [...c].sort((a, b) => (counts[b.name]?.total || 0) - (counts[a.name]?.total || 0))[0];
  });
  return out;
}

const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

export default function FolderTree({ account, folders, counts, current, favourites, onOpen, onDrop, onNew, onRename, onDelete }) {
  const key = `mail.open.${account}`;
  const [open, setOpen] = useState(() => new Set(lsGet(key)));
  const [find, setFind] = useState('');
  const [dragOver, setDragOver] = useState(null);
  useEffect(() => { setOpen(new Set(lsGet(key))); }, [key]);
  const toggle = (name) => setOpen((s) => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); lsSet(key, [...n]); return n; });

  const byParent = useMemo(() => {
    const m = {};
    folders.forEach((f) => { (m[f.parent ?? ''] ||= []).push(f); });
    const rank = (f) => (f.special ? SPECIAL[f.special].order : 9);
    Object.values(m).forEach((L) => L.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' })));
    return m;
  }, [folders]);

  // Keep the open folder's branch visible.
  useEffect(() => {
    const f = folders.find((x) => x.name === current);
    if (!f?.parent) return;
    const anc = []; let p = f.parent;
    while (p) { anc.push(p); p = folders.find((x) => x.name === p)?.parent; }
    if (anc.some((a) => !open.has(a))) setOpen((s) => { const n = new Set([...s, ...anc]); lsSet(key, [...n]); return n; });
     
  }, [current, folders]);

  const favNames = new Set(Object.values(favourites).map((f) => f.name));
  const dropProps = (f) => ({
    onDragOver: (e) => { if (e.dataTransfer.types.includes('application/x-pbmail')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(f.name); } },
    onDragLeave: () => setDragOver((d) => (d === f.name ? null : d)),
    onDrop: (e) => { e.preventDefault(); setDragOver(null); try { const uids = JSON.parse(e.dataTransfer.getData('application/x-pbmail')); if (uids?.length) onDrop(f, uids); } catch { /* not ours */ } },
  });

  // A plain render function (not a component), so an open ⋯ menu survives re-renders.
  const row = ({ f, depth, label, icon: Icon, fav }) => {
    const kids = byParent[f.name] || [];
    const isOpen = open.has(f.name);
    const c = counts[f.name];
    const active = current === f.name;
    return (
      <div className={`group relative flex items-center h-8 mx-1.5 pr-1 rounded-md text-[14px] cursor-pointer select-none ${active ? 'bg-ol-sel text-ol-text font-semibold' : dragOver === f.name ? 'bg-ol-soft ring-1 ring-ol' : 'hover:bg-ol-line/60 text-ol-text'}`}
        style={{ paddingLeft: 2 + depth * 16 }} onClick={() => onOpen(f.name)} onDoubleClick={() => !fav && kids.length && toggle(f.name)} {...dropProps(f)} title={f.path}>
        {!fav && kids.length > 0 ? (
          <button onClick={(e) => { e.stopPropagation(); toggle(f.name); }} onDoubleClick={(e) => e.stopPropagation()} className="w-7 h-8 -my-1 shrink-0 flex items-center justify-center rounded text-ol-sub hover:text-ol-text hover:bg-white/80" aria-label={isOpen ? 'Collapse' : 'Expand'} aria-expanded={isOpen}>
            <ChevronRight className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
        ) : <span className="w-7 shrink-0" />}
        {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-ol" />}
        <Icon className={`w-4 h-4 shrink-0 mr-2.5 ${active ? 'text-ol' : 'text-ol-sub'}`} strokeWidth={1.6} />
        <span className={`truncate flex-1 min-w-0 ${c?.unread ? 'font-semibold' : ''}`}>{label}</span>
        {c?.unread > 0 && <span className="ml-1 text-[13px] font-semibold tabular-nums text-ol">{c.unread}</span>}
        {!fav && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button onClick={(e) => e.stopPropagation()} className="ml-1 w-6 h-6 shrink-0 flex items-center justify-center rounded md:opacity-0 md:group-hover:opacity-100 focus:opacity-100 text-ol-sub hover:text-ol-text hover:bg-white" aria-label="Folder actions">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => onNew(f)}><FolderPlus className="w-4 h-4 mr-2" /> New subfolder</DropdownMenuItem>
              {!f.special && <DropdownMenuItem onSelect={() => onRename(f)}><Pencil className="w-4 h-4 mr-2" /> Rename</DropdownMenuItem>}
              {!f.special && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => onDelete(f)} className="text-red-600"><Trash2 className="w-4 h-4 mr-2" /> Delete folder</DropdownMenuItem></>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    );
  };

  const tree = (parent, depth) => (byParent[parent] || []).filter((f) => depth > 0 || !favNames.has(f.name) || (byParent[f.name] || []).length).map((f) => (
    <React.Fragment key={f.name}>
      {row({ f, depth, label: f.label, icon: open.has(f.name) && (byParent[f.name] || []).length ? FolderOpen : (f.special ? SPECIAL[f.special].icon : Folder) })}
      {open.has(f.name) && tree(f.name, depth + 1)}
    </React.Fragment>
  ));

  // Favourites / Folders headings fold like Outlook's (remembered per mailbox).
  const shutKey = `mail.shut.${account}`;
  const [shut, setShut] = useState(() => new Set(lsGet(shutKey)));
  useEffect(() => { setShut(new Set(lsGet(shutKey))); }, [shutKey]);
  const flip = (k) => setShut((s0) => { const n = new Set(s0); n.has(k) ? n.delete(k) : n.add(k); lsSet(shutKey, [...n]); return n; });
  const section = (k, label) => (
    <button type="button" onClick={() => flip(k)} aria-expanded={!shut.has(k)}
      className="flex-1 mx-1.5 h-8 px-1 rounded-md flex items-center gap-1 text-[14px] font-semibold text-ol-text hover:bg-ol-line/60 text-left">
      <ChevronRight className={`w-4 h-4 text-ol-sub transition-transform ${shut.has(k) ? '' : 'rotate-90'}`} />{label}
    </button>
  );

  const q = find.trim().toLowerCase();
  const hits = q ? folders.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 80) : [];

  return (
    <div className="flex flex-col min-h-0">
      <div className="px-2 pt-2 pb-1">
        <div className="flex items-center gap-1.5 h-8 px-2 rounded-md border border-transparent bg-white/70 focus-within:bg-white focus-within:border-ol-line">
          <Search className="w-3.5 h-3.5 text-ol-sub shrink-0" />
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a folder" className="flex-1 bg-transparent text-[13px] outline-none min-w-0" />
          {find && <button onClick={() => setFind('')} aria-label="Clear"><X className="w-3.5 h-3.5 text-neutral-400 hover:text-neutral-900" /></button>}
        </div>
      </div>
      {q ? (
        <div className="py-1">
          {hits.length === 0 && <p className="px-4 py-3 text-[12px] text-neutral-400">No folder matches.</p>}
          {hits.map((f) => (
            <div key={f.name} onClick={() => { onOpen(f.name); setFind(''); }} {...dropProps(f)}
              className={`mx-1.5 px-3 py-1.5 rounded-md cursor-pointer ${dragOver === f.name ? 'bg-ol-soft' : 'hover:bg-ol-line/60'}`}>
              <div className="text-[13px] truncate">{f.label}</div>
              <div className="text-[11px] text-neutral-400 truncate">{f.path}</div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="flex pt-1">{section('fav', 'Favourites')}</div>
          {!shut.has('fav') && Object.entries(favourites).sort((a, b) => SPECIAL[a[0]].order - SPECIAL[b[0]].order).map(([k, f]) => (
            <React.Fragment key={k}>{row({ f, depth: 0, label: SPECIAL[k].label, icon: SPECIAL[k].icon, fav: true })}</React.Fragment>
          ))}
          <div className="pt-3 flex items-center justify-between pr-2">
            {section('tree', 'Folders')}
            <button onClick={() => onNew(null)} className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[13px] text-ol hover:bg-white"><FolderPlus className="w-4 h-4" /> New folder</button>
          </div>
          {!shut.has('tree') && tree('', 0)}
        </>
      )}
    </div>
  );
}
