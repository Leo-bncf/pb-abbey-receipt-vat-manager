/* Tenant · To let — the listing of each empty unit (title, text, asking rent,
 * EPC, photos) and whether it shows on the public page pbabbey.com/to-let.
 * Enquiries sent from that page land here (and in Actions). Nothing is emailed. */
import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus, Trash2, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { base44, supabase } from '@/api/base44Client';
import TenantShell from './TenantShell';
import { fmtDate } from './ui';

const inputCls = 'h-9 w-full px-2.5 border border-neutral-300 bg-white text-[14px] rounded-md';

function ListingCard({ u }) {
  const qc = useQueryClient();
  const [v, setV] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setV({ listing_title: u.listing_title || '', listing_text: u.listing_text || '', asking_rent: u.asking_rent ?? '', epc_rating: u.epc_rating || '', photos: u.photos || [], listed: !!u.listed }); }, [u]);
  const save = useMutation({
    mutationFn: (patch) => base44.entities.Unit.update(u.id, { ...patch, updated_date: new Date().toISOString() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });
  if (!v) return null;
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  const fields = () => ({ listing_title: v.listing_title.trim() || null, listing_text: v.listing_text.trim() || null, asking_rent: v.asking_rent === '' ? null : Number(v.asking_rent), epc_rating: v.epc_rating.trim() || null });

  const upload = async (files) => {
    setErr(''); setUploading(true);
    try {
      const urls = [];
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue;
        const path = `${u.id}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_')}`;
        const { error } = await supabase.storage.from('listings').upload(path, f, { contentType: f.type, upsert: false });
        if (error) throw error;
        urls.push(supabase.storage.from('listings').getPublicUrl(path).data.publicUrl);
      }
      const photos = [...v.photos, ...urls];
      setV((s) => ({ ...s, photos }));
      await save.mutateAsync({ photos });
    } catch (e) { setErr(`Upload failed: ${e.message || e}`); }
    finally { setUploading(false); }
  };
  const removePhoto = async (url) => {
    const photos = v.photos.filter((p) => p !== url);
    setV((s) => ({ ...s, photos }));
    await save.mutateAsync({ photos });
    const path = url.split('/listings/')[1]; if (path) await supabase.storage.from('listings').remove([decodeURIComponent(path)]);
  };
  const toggleListed = async () => {
    const listed = !v.listed;
    if (listed && !v.epc_rating.trim() && !confirm('No EPC rating yet. Adverts for commercial lettings should show it when there is one.\n\nShow this unit on the public page anyway?')) return;
    setV((s) => ({ ...s, listed }));
    await save.mutateAsync({ ...fields(), listed });
  };

  return (
    <article className="bg-white border rule">
      <div className="px-4 py-3 border-b rule flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-neutral-900">{u.reference}</p>
          <p className="text-[12px] text-neutral-500">{u.site}{u.area_sqft ? ` · ${Number(u.area_sqft).toLocaleString('en-GB')} sq ft` : ''}{u.market_rent ? ` · market rent about £${Math.round(u.market_rent).toLocaleString('en-GB')}` : ''}</p>
        </div>
        <button onClick={toggleListed} className={`h-8 px-3 text-[12px] border inline-flex items-center gap-1.5 ${v.listed ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-neutral-300 text-neutral-600'}`}>
          {v.listed ? <><Check className="w-3.5 h-3.5" /> Shown on the To let page</> : 'Not shown · show on the To let page'}
        </button>
      </div>
      <div className="p-4 grid md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-3 min-w-0">
          <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">Title</span><input className={inputCls} value={v.listing_title} onChange={set('listing_title')} /></label>
          <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">Description</span><textarea rows={5} className="w-full px-2.5 py-2 border border-neutral-300 bg-white text-[14px] rounded-md" value={v.listing_text} onChange={set('listing_text')} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">Asking rent a year (£)</span><input type="number" step="50" className={inputCls} value={v.asking_rent} onChange={set('asking_rent')} /></label>
            <label className="block"><span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">EPC rating</span><input className={inputCls} placeholder="e.g. C (62)" value={v.epc_rating} onChange={set('epc_rating')} /></label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" className="bg-neutral-900 hover:bg-neutral-800" onClick={() => save.mutate(fields())} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
            {save.isSuccess && <span className="text-[12px] text-emerald-700">Saved</span>}
            {save.isError && <span className="text-[12px] text-red-700">Could not save: {save.error.message}</span>}
          </div>
        </div>
        <div className="min-w-0">
          <span className="text-[11px] uppercase tracking-[0.1em] text-neutral-500 block mb-1">Photos (the first one is the main photo)</span>
          <div className="grid grid-cols-3 gap-2">
            {v.photos.map((p) => (
              <div key={p} className="relative group">
                <img src={p} alt="" className="aspect-[4/3] w-full object-cover bg-neutral-100" />
                <button onClick={() => removePhoto(p)} className="absolute top-1 right-1 p-1 bg-white/90 text-neutral-600 hover:text-red-600" title="Remove photo"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
            <label className="aspect-[4/3] border border-dashed border-neutral-300 flex flex-col items-center justify-center gap-1 text-[12px] text-neutral-500 cursor-pointer hover:bg-neutral-50">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} Add photos
              <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload([...e.target.files])} />
            </label>
          </div>
          {err && <p className="mt-2 text-[12px] text-red-700">{err}</p>}
        </div>
      </div>
    </article>
  );
}

export default function Listings() {
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({ queryKey: ['units'], queryFn: () => base44.entities.Unit.list('reference') });
  const enq = useQuery({ queryKey: ['enquiries'], queryFn: async () => { const { data, error } = await supabase.from('enquiries').select('*').order('created_date', { ascending: false }).limit(200); if (error) throw error; return data; } });
  const mark = useMutation({
    mutationFn: async ({ e, status }) => { const { error } = await supabase.from('enquiries').update({ status }).eq('id', e.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enquiries'] }); qc.invalidateQueries({ queryKey: ['actions'] }); },
  });
  const empty = units.filter((u) => !u.tenant_id && !/yard/i.test(u.reference || ''));
  const shown = empty.filter((u) => u.listed).length;

  return (
    <TenantShell title="To let" subtitle={`${empty.length} empty units · ${shown} shown on the public page`}
      actions={<>
        <a href="/to-let?preview=1" target="_blank" rel="noreferrer" className="h-9 px-3 inline-flex items-center gap-1.5 text-[13px] border border-neutral-300 bg-white text-neutral-700 hover:text-neutral-900"><ExternalLink className="w-4 h-4" /> Preview the page</a>
      </>}>
      <p className="mb-4 text-[13px] text-neutral-600">The public page is <span className="font-fig select-all">pbabbey.com/to-let</span>. A unit only appears there once it is marked “Shown on the To let page”. Enquiries from the page arrive below and in Actions; nothing is emailed.</p>
      <div className="flex flex-col gap-4 mb-10">
        {empty.map((u) => <ListingCard key={u.id} u={u} />)}
        {empty.length === 0 && <p className="py-10 text-center text-[13px] text-neutral-400 bg-white border rule">No empty units.</p>}
      </div>

      <h2 className="text-[11px] uppercase tracking-[0.1em] font-medium text-neutral-400 mb-3">Enquiries</h2>
      <ul className="bg-white border rule divide-y divide-neutral-200">
        {(enq.data || []).map((e) => (
          <li key={e.id} className="px-4 py-3 flex flex-col md:flex-row md:items-start gap-2 md:gap-6">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-neutral-900">{e.name}{e.company ? ` · ${e.company}` : ''} <span className="font-normal text-[12px] text-neutral-400">{fmtDate(e.created_date)}{e.unit_reference ? ` · ${e.unit_reference}` : ' · general enquiry'}</span></p>
              <p className="text-[13px] text-neutral-600 font-fig select-all">{[e.email, e.phone].filter(Boolean).join(' · ')}</p>
              {e.message && <p className="mt-1 text-[13px] text-neutral-700 whitespace-pre-line break-words">{e.message}</p>}
            </div>
            <div className="flex gap-1.5 shrink-0">
              {e.status === 'new'
                ? <button onClick={() => mark.mutate({ e, status: 'answered' })} className="h-8 px-2.5 text-[12px] bg-neutral-900 text-white">Mark answered</button>
                : <span className="text-[12px] text-emerald-700">answered</span>}
            </div>
          </li>
        ))}
        {!enq.isLoading && !(enq.data || []).length && <li className="px-4 py-8 text-center text-[13px] text-neutral-400">No enquiries yet.</li>}
      </ul>
    </TenantShell>
  );
}
