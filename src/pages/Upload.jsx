/* Upload: put documents in the scan queue. The server (scan-runner) reads them,
 * files the receipts and emails the sender when it's done — no need to keep
 * this page open. History lets you download the original or rescan it. */
import { wsPath, currentWorkspace } from '@/lib/workspace';
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Clock, Download, RefreshCw, Loader2, CheckCircle, AlertCircle, Folder, FolderPlus, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format, formatDistanceToNow } from 'date-fns';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import UploadZone from '../components/upload/UploadZone';
import ScanButton from '../components/upload/ScanButton';
import AppShell from '@/components/AppShell';
import { askText } from '@/components/AskText';

// "doc.pdf [2/5]" -> "doc.pdf"
const baseDocName = (fileName) => (fileName || '').replace(/\s*\[\d+\/\d+\]\s*$/, '').trim();
// "…_PB Abbey_August-September 2026.pdf" -> "August-September 2026" (pins the year for the scanner)
const periodFromName = (fileName) => {
  const m = (fileName || '').match(/([A-Za-z]+(?:-[A-Za-z]+)?\s+\d{4})\s*(?:\[[^\]]*\])?\.?[a-z0-9]*$/i);
  return m ? m[1].trim() : '';
};
const ext = (name) => (name.split('.').pop() || '').toLowerCase();

const statusView = {
  queued: { label: 'Waiting', cls: 'text-neutral-600 border-neutral-200 bg-neutral-50', icon: Clock },
  running: { label: 'Reading…', cls: 'text-blue-700 border-blue-200 bg-blue-50', icon: Loader2 },
  done: { label: 'Done', cls: 'text-emerald-700 border-emerald-200 bg-emerald-50', icon: CheckCircle },
  error: { label: 'Failed', cls: 'text-red-700 border-red-200 bg-red-50', icon: AlertCircle },
};

export default function Upload() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const flat = currentWorkspace() === 'carnas'; // Carnas: no folders, one list
  const [folderId, setFolderIdRaw] = useState(() => { try { return localStorage.getItem('upload_folder') || null; } catch { return null; } });
  const setFolderId = (id) => { setFolderIdRaw(id); try { id ? localStorage.setItem('upload_folder', id) : localStorage.removeItem('upload_folder'); } catch { /* private mode */ } };
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const { data: folders = [] } = useQuery({ queryKey: ['folders'], queryFn: () => base44.entities.Folder.list('name') });
  const { data: receipts = [] } = useQuery({ queryKey: ['receipts'], queryFn: () => base44.entities.Receipt.list('-created_date', 5000) });
  const { data: jobs = [] } = useQuery({
    queryKey: ['scan_jobs'],
    queryFn: () => base44.entities.ScanJob.list('-created_date', 25),
    // Poll while something is still being read, then stop.
    refetchInterval: (q) => ((q.state.data || []).some((j) => j.status === 'queued' || j.status === 'running') ? 4000 : false),
  });
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');

  // Refresh receipt lists once a job finishes.
  const doneKey = jobs.filter((j) => j.status === 'done').map((j) => j.id).join(',');
  React.useEffect(() => { qc.invalidateQueries({ queryKey: ['receipts'] }); }, [doneKey]);

  const history = useMemo(() => {
    const byDoc = {};
    receipts.forEach((r) => {
      const name = baseDocName(r.file_name);
      if (!name) return;
      const d = (byDoc[name] ||= { name, count: 0, toCheck: 0, date: r.created_date, file_url: r.file_url, file_type: r.file_type, folder_id: r.folder_id });
      d.count += 1;
      if (r.needs_review && !r.is_reviewed) d.toCheck += 1;
      if (new Date(r.created_date) > new Date(d.date)) Object.assign(d, { date: r.created_date, file_url: r.file_url, file_type: r.file_type, folder_id: r.folder_id });
    });
    return Object.values(byDoc).sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [receipts]);
  // A remembered folder that has since been deleted: forget it.
  React.useEffect(() => { if (folderId && folders.length && !folders.some((f) => f.id === folderId)) setFolderId(null); }, [folders, folderId]);
  const known = useMemo(() => new Set(history.map((d) => d.name.toLowerCase())), [history]);

  const queue = async (files) => {
    setMsg(null);
    const dupes = files.filter((f) => known.has(f.name.toLowerCase()));
    if (dupes.length && !confirm(`Already uploaded:\n\n${dupes.map((f) => `• ${f.name}`).join('\n')}\n\nOK = upload again anyway, Cancel = stop.`)) return;
    setBusy(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        await base44.entities.ScanJob.create({
          file_url, file_name: file.name, file_type: ext(file.name) === 'jpeg' ? 'jpg' : ext(file.name), folder_id: flat ? null : folderId,
          period: periodFromName(file.name), source: 'upload', notify_email: user?.email || null, created_by: user?.email || null,
        });
      }
      setMsg(`${files.length} document${files.length > 1 ? 's' : ''} sent for reading. You can leave this page — we'll email ${user?.email || 'you'} when it's done.`);
      qc.invalidateQueries({ queryKey: ['scan_jobs'] });
    } catch (e) {
      setMsg(`Upload failed: ${e.message}`);
    } finally { setBusy(false); }
  };

  const rescan = async (doc) => {
    if (!doc.file_url) return alert('The original file is not available.');
    if (!confirm(`Read "${doc.name}" again?\n\nIts ${doc.count} line(s) will be replaced when the new reading is ready.` +
      (doc.toCheck < doc.count ? '\nLines already validated will be replaced too.' : ''))) return;
    await base44.entities.ScanJob.create({
      file_url: doc.file_url, file_name: doc.name, file_type: doc.file_type || 'pdf', folder_id: doc.folder_id || null,
      period: periodFromName(doc.name), source: 'rescan', replace_doc: doc.name, notify_email: user?.email || null, created_by: user?.email || null,
    });
    qc.invalidateQueries({ queryKey: ['scan_jobs'] });
  };

  // A failed scan never produced receipts, so it isn't in the documents list: retry it here.
  const retry = async (j) => {
    await base44.entities.ScanJob.update(j.id, { status: 'queued', error: null, attempts: 0, started_at: null, finished_at: null, updated_date: new Date().toISOString() });
    qc.invalidateQueries({ queryKey: ['scan_jobs'] });
  };

  const newFolder = async () => {
    const name = await askText('New folder name', { okLabel: 'Create' });
    if (!name?.trim()) return;
    const f = await base44.entities.Folder.create({ name: name.trim() });
    await qc.invalidateQueries({ queryKey: ['folders'] });
    if (f?.id) setFolderId(f.id);
  };

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const docs = showAll ? history : history.slice(0, 8);
  // Live "to check" per document (the count saved on the scan job goes stale once lines are validated).
  const liveToCheck = (j) => history.find((d) => d.name === baseDocName(j.replace_doc || j.file_name))?.toCheck || 0;

  return (
    <AppShell title="Upload" subtitle="Photos or PDFs of receipts — read on our server, you can close the page">
      <div className="max-w-3xl">
        {!flat && <section>
          <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-400 mb-2 block">1 · Folder</label>
          <div className="flex gap-2 max-w-md">
            <Select value={folderId || ''} onValueChange={(v) => setFolderId(v || null)}>
              <SelectTrigger className="bg-white border-neutral-300 rounded-none min-w-0"><SelectValue placeholder="Select a folder…" /></SelectTrigger>
              <SelectContent>{folders.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" className="gap-1.5 border-neutral-300 shrink-0 rounded-none" onClick={newFolder}><FolderPlus className="w-4 h-4" /> New</Button>
          </div>
        </section>}

        <section className={flat ? '' : 'mt-7'}>
          <label className="text-[11px] uppercase tracking-[0.1em] text-neutral-400 mb-2 block">{flat ? 'Receipts' : '2 · Receipts'}</label>
          {flat || folderId ? <><UploadZone onFilesSelected={queue} isProcessing={busy} /><ScanButton onScanned={queue} disabled={busy} label={flat ? 'Scan into Carnas' : 'Scan into this folder'} /></> : (
            <div className="border border-dashed border-neutral-300 px-5 py-7 text-center">
              <Folder className="w-5 h-5 text-neutral-300 mx-auto mb-2" /><p className="text-[13px] text-neutral-400">Pick a folder first.</p>
            </div>
          )}
          {msg && <p className="mt-4 text-[13px] text-neutral-700 bg-white border rule px-4 py-3">{msg}</p>}
        </section>

        {/* Scans — live */}
        {jobs.length > 0 && (
          <div className="bg-white border rule mt-10">
            <div className="px-4 sm:px-5 h-11 border-b rule flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Recent scans</h3>
              {active.length > 0 && <span className="text-[12px] text-blue-700 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {active.length} in progress</span>}
            </div>
            <ul className="divide-y divide-neutral-100">
              {jobs.slice(0, 6).map((j) => {
                const v = statusView[j.status] || statusView.queued;
                return (
                  <li key={j.id} className="px-4 sm:px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] text-neutral-800 min-w-0 break-words flex items-start gap-1.5" title={j.file_name}>
                        {j.source === 'email' && <Mail className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />}<span className="min-w-0">{j.file_name}</span>
                      </p>
                      <div className="shrink-0 flex items-center gap-2">
                        {j.status === 'error' && (
                          <button onClick={() => retry(j)} className="inline-flex items-center gap-1 text-[12px] text-neutral-700 hover:text-neutral-900 underline"><RefreshCw className="w-3 h-3" /> Try again</button>
                        )}
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] border ${v.cls}`}>
                          <v.icon className={`w-3 h-3 ${j.status === 'running' ? 'animate-spin' : ''}`} /> {v.label}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-neutral-400 mt-1">
                      {j.status === 'done' && <>{plural(j.receipts_count || 0, 'receipt')}{liveToCheck(j) > 0 ? <> · <Link to={wsPath('/Review')} className="text-amber-700 underline">{liveToCheck(j)} to check</Link></> : ''} · </>}
                      {j.source === 'email' ? 'from accounts@ inbox' : j.source === 'rescan' ? 'rescan' : (j.created_by || '')} · {formatDistanceToNow(new Date(j.created_date), { addSuffix: true })}
                      {j.status === 'error' && j.error ? <span className="text-red-600"> · {j.error}</span> : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div className="bg-white border rule mt-6">
            <div className="px-4 sm:px-5 h-11 border-b rule flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">Uploaded documents</h3>
              <span className="text-[11px] text-neutral-400 font-fig">{history.length}</span>
            </div>
            <ul className="divide-y divide-neutral-100">
              {docs.map((doc) => (
                <li key={doc.name} className="px-4 sm:px-5 py-3 flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4">
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <FileText className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-[13px] text-neutral-800 break-words sm:truncate" title={doc.name}>{doc.name}</p>
                      <p className="text-[11px] text-neutral-400 font-fig">
                        {doc.date ? format(new Date(doc.date), 'd MMM yyyy') : ''} · {plural(doc.count, 'receipt')}
                        {doc.toCheck > 0 && <> · <Link to={wsPath('/Review')} className="text-amber-700 underline">{doc.toCheck} to check</Link></>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0 pl-[26px] sm:pl-0">
                    {doc.file_url && <a href={doc.file_url} download={doc.name} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-neutral-700 hover:text-neutral-900 whitespace-nowrap"><Download className="w-3.5 h-3.5" /> Download</a>}
                    <button onClick={() => rescan(doc)} disabled={active.some((j) => j.replace_doc === doc.name)} className="inline-flex items-center gap-1 text-[12px] text-neutral-700 hover:text-neutral-900 whitespace-nowrap disabled:opacity-40">
                      <RefreshCw className="w-3.5 h-3.5" /> Rescan
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {history.length > 8 && (
              <button onClick={() => setShowAll(!showAll)} className="w-full h-10 border-t rule text-[12px] text-neutral-500 hover:text-neutral-900">
                {showAll ? 'Show fewer' : `Show all ${history.length}`}
              </button>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
