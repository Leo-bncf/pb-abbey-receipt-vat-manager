/* Public page: PB Abbey's empty units that are marked "Show on the To let page",
 * with an enquiry form. Open to anyone (no sign-in). Enquiries are stored for
 * PB Abbey to read in the app; nothing is emailed from here.
 * Signed-in users can add ?preview=1 to see every empty unit before it is shown. */
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/base44Client';

const gbp0 = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

function Photos({ photos, title }) {
  const [i, setI] = useState(0);
  if (!photos?.length) return <div className="aspect-[4/3] w-full bg-neutral-100 flex items-center justify-center text-[12px] text-neutral-400">Photos to follow</div>;
  return (
    <div className="relative">
      <img src={photos[i]} alt={`${title}, photo ${i + 1}`} className="aspect-[4/3] w-full object-cover bg-neutral-100" />
      {photos.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
          {photos.map((_, j) => <button key={j} onClick={() => setI(j)} aria-label={`Photo ${j + 1}`} className={`w-2.5 h-2.5 rounded-full border border-white ${j === i ? 'bg-white' : 'bg-white/30'}`} />)}
        </div>
      )}
    </div>
  );
}

export default function ToLet() {
  const [params] = useSearchParams();
  const preview = params.get('preview') === '1';
  const [units, setUnits] = useState(null);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ unit: '', name: '', email: '', phone: '', company: '', message: '', website: '' });
  const [state, setState] = useState({ busy: false, done: false, error: '' });

  useEffect(() => {
    document.title = 'Offices to let in Exeter · PB Abbey';
    supabase.rpc('public_listings', { p_preview: preview }).then(({ data, error }) => {
      if (error) setErr('The list could not be loaded. Please try again later.');
      setUnits(data || []);
    });
  }, [preview]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    if (form.website) return setState({ busy: false, done: true, error: '' }); // filled by bots only
    setState({ busy: true, done: false, error: '' });
    const { error } = await supabase.rpc('submit_enquiry', { p_unit: form.unit || null, p_name: form.name, p_email: form.email, p_phone: form.phone, p_company: form.company, p_message: form.message });
    if (error) return setState({ busy: false, done: false, error: error.message || 'Your enquiry could not be saved. Please try again.' });
    setState({ busy: false, done: true, error: '' });
  };
  const enquire = (u) => { setForm((f) => ({ ...f, unit: u.id })); document.getElementById('enquire')?.scrollIntoView({ behavior: 'smooth' }); };
  const inputCls = 'h-10 w-full px-3 border border-neutral-300 bg-white text-[15px] focus:outline-none focus:border-neutral-900';

  return (
    <div className="min-h-screen bg-[#f6f5f1] text-neutral-900">
      {preview && <div className="bg-amber-100 text-amber-900 text-[13px] text-center py-2 px-4">Preview: shows every empty unit, including ones not yet published. Visitors only see units marked “Show on the To let page”.</div>}
      <header className="border-b border-neutral-300">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <p className="text-[12px] uppercase tracking-[0.14em] text-neutral-500">PB Abbey Ltd</p>
            <h1 className="text-[28px] sm:text-[34px] font-semibold tracking-tight leading-tight">Offices and units to let</h1>
          </div>
          <p className="text-[14px] text-neutral-600">Exeter and North Devon · <span className="select-all">office@pbabbey.com</span></p>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-10">
        {units === null && <p className="text-neutral-500">Loading…</p>}
        {err && <p className="text-red-700">{err}</p>}
        {units && !units.length && !err && <p className="text-[16px] text-neutral-600">Nothing is available at the moment. You are welcome to send an enquiry below and we will tell you when something comes up.</p>}

        {units?.map((u) => (
          <article key={u.id} className="bg-white border border-neutral-300 grid md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Photos photos={u.photos} title={u.listing_title || u.reference} />
            <div className="p-5 sm:p-6 flex flex-col gap-4 min-w-0">
              <div>
                <p className="text-[12px] uppercase tracking-[0.12em] text-neutral-500">{u.site}{preview && !u.listed && <span className="ml-2 normal-case tracking-normal text-amber-700">· not published</span>}</p>
                <h2 className="mt-1 text-[21px] font-semibold leading-snug">{u.listing_title || u.reference}</h2>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
                {u.area_sqft && <div><dt className="text-neutral-500 text-[12px]">Size</dt><dd className="font-medium">{Number(u.area_sqft).toLocaleString('en-GB')} sq ft <span className="text-neutral-500 font-normal">({Math.round(u.area_sqft * 0.0929).toLocaleString('en-GB')} m²)</span></dd></div>}
                {u.asking_rent && <div><dt className="text-neutral-500 text-[12px]">Rent</dt><dd className="font-medium">{gbp0(u.asking_rent)} a year{u.area_sqft ? <span className="text-neutral-500 font-normal"> · £{(u.asking_rent / u.area_sqft).toFixed(2)}/sq ft</span> : ''}</dd></div>}
                {Number(u.service_charge) > 0 && <div><dt className="text-neutral-500 text-[12px]">Service charge</dt><dd className="font-medium">about {gbp0(u.service_charge)} a year</dd></div>}
                <div><dt className="text-neutral-500 text-[12px]">VAT</dt><dd className="font-medium">{u.vat_applicable === false ? 'Not charged' : 'Charged on rent and service charge'}</dd></div>
                {u.epc_rating && <div><dt className="text-neutral-500 text-[12px]">EPC</dt><dd className="font-medium">{u.epc_rating}</dd></div>}
                <div><dt className="text-neutral-500 text-[12px]">Address</dt><dd className="font-medium">{u.address}</dd></div>
              </dl>
              {u.listing_text && <p className="text-[15px] leading-relaxed text-neutral-700 whitespace-pre-line">{u.listing_text}</p>}
              <button onClick={() => enquire(u)} className="self-start h-10 px-5 bg-neutral-900 text-white text-[14px] hover:bg-neutral-700">Enquire about this</button>
            </div>
          </article>
        ))}

        <section id="enquire" className="bg-white border border-neutral-300 p-5 sm:p-8 grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-8">
          <div>
            <h2 className="text-[21px] font-semibold">Enquire</h2>
            <p className="mt-2 text-[15px] text-neutral-600">Tell us what you are looking for and how to reach you. We reply in person, usually within a couple of days.</p>
            <p className="mt-4 text-[14px] text-neutral-600">Or email <span className="select-all font-medium text-neutral-900">office@pbabbey.com</span></p>
          </div>
          {state.done ? (
            <div className="self-center text-[16px]"><p className="font-semibold">Thank you.</p><p className="text-neutral-600 mt-1">We have your enquiry and will be in touch.</p></div>
          ) : (
            <form onSubmit={submit} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 text-[13px] text-neutral-600">Unit
                <select value={form.unit} onChange={set('unit')} className={`${inputCls} mt-1`} id="enq-unit">
                  <option value="">General enquiry</option>
                  {units?.map((u) => <option key={u.id} value={u.id}>{u.listing_title || u.reference}</option>)}
                </select>
              </label>
              <label className="col-span-2 sm:col-span-1 text-[13px] text-neutral-600">Name *<input required value={form.name} onChange={set('name')} className={`${inputCls} mt-1`} id="enq-name" autoComplete="name" /></label>
              <label className="col-span-2 sm:col-span-1 text-[13px] text-neutral-600">Company<input value={form.company} onChange={set('company')} className={`${inputCls} mt-1`} id="enq-company" autoComplete="organization" /></label>
              <label className="col-span-2 sm:col-span-1 text-[13px] text-neutral-600">Email<input type="email" value={form.email} onChange={set('email')} className={`${inputCls} mt-1`} id="enq-email" autoComplete="email" /></label>
              <label className="col-span-2 sm:col-span-1 text-[13px] text-neutral-600">Phone<input value={form.phone} onChange={set('phone')} className={`${inputCls} mt-1`} id="enq-phone" autoComplete="tel" /></label>
              <label className="col-span-2 text-[13px] text-neutral-600">Message<textarea value={form.message} onChange={set('message')} rows={4} className="w-full mt-1 px-3 py-2 border border-neutral-300 bg-white text-[15px] focus:outline-none focus:border-neutral-900" id="enq-message" /></label>
              <input value={form.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
              {state.error && <p className="col-span-2 text-[14px] text-red-700">{state.error}</p>}
              <p className="col-span-2 text-[12px] text-neutral-500">We only use your details to reply to this enquiry. An email or a phone number is needed.</p>
              <button disabled={state.busy} className="col-span-2 sm:col-span-1 h-11 bg-neutral-900 text-white text-[15px] hover:bg-neutral-700 disabled:opacity-50">{state.busy ? 'Sending…' : 'Send enquiry'}</button>
            </form>
          )}
        </section>
      </main>
      <footer className="border-t border-neutral-300"><div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 text-[12px] text-neutral-500">PB Abbey Ltd · Registered in England and Wales no. 08819146</div></footer>
    </div>
  );
}
