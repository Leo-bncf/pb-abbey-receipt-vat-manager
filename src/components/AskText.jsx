/* askText("New folder name:") → Promise<string|null>. Replaces window.prompt(), which
 * the desktop app (Electron) does not support at all and which looks out of place on
 * phones. <AskTextHost /> is mounted once in App.jsx. */
import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

let open = null;
export function askText(title, { defaultValue = '', placeholder = '', okLabel = 'OK' } = {}) {
  return new Promise((resolve) => {
    if (!open) { resolve(window.prompt(title, defaultValue)); return; }
    open({ title, defaultValue, placeholder, okLabel, resolve });
  });
}

export function AskTextHost() {
  const [req, setReq] = useState(null);
  const [value, setValue] = useState('');
  const input = useRef(null);
  const pending = useRef(null); // { resolve, value } until the dialog has fully closed
  useEffect(() => { open = (r) => { setValue(r.defaultValue || ''); pending.current = { resolve: r.resolve, value: null }; setReq(r); }; return () => { open = null; }; }, []);
  // Answer only once the dialog has let go of the focus (onCloseAutoFocus), so the caller
  // can put the cursor back where it was (e.g. inserting a link in the mail text).
  const done = (v) => { if (pending.current) pending.current.value = v; setReq(null); };
  const settle = (e) => { e.preventDefault(); const p0 = pending.current; pending.current = null; p0?.resolve(p0.value); };
  return (
    <Dialog open={!!req} onOpenChange={(o) => { if (!o) done(null); }}>
      <DialogContent className="max-w-sm rounded-lg" onCloseAutoFocus={settle} onOpenAutoFocus={(e) => { e.preventDefault(); setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0); }}>
        <DialogHeader><DialogTitle className="text-[15px] font-semibold">{req?.title}</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); done(value); }} className="space-y-4">
          <input ref={input} value={value} onChange={(e) => setValue(e.target.value)} placeholder={req?.placeholder}
            className="h-10 w-full rounded-md border border-[#d1d1d1] px-3 text-[14px] bg-white focus:outline-none focus:border-[#0f6cbd] focus:ring-1 focus:ring-[#0f6cbd]" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => done(null)} className="h-9 px-4 rounded-md border border-[#e0e0e0] bg-white text-[14px] hover:bg-[#f5f5f5]">Cancel</button>
            <button type="submit" disabled={!value.trim()} className="h-9 px-4 rounded-md bg-[#0f6cbd] hover:bg-[#115ea3] text-white text-[14px] font-semibold disabled:opacity-50">{req?.okLabel || 'OK'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
