// Getting your data out: CSV for spreadsheets, JSON backup for restoring.
import { state, allPhotos, putPhoto, saveRecords, saveSettings, saveMixes } from './store.js';
import * as M from './model.js';

const COLUMNS = [
  ['Artist', (r) => r.artist],
  ['Title', (r) => r.title],
  ['Label', (r) => r.label],
  ['Catalogue number', (r) => r.catno],
  ['Year', (r) => r.year],
  ['Country', (r) => r.country],
  ['Format', (r) => r.formatText],
  ['Genres', (r) => (r.genres || []).join('; ')],
  ['Styles', (r) => (r.styles || []).join('; ')],
  ['Barcode', (r) => r.barcode],
  ['Record grade', (r) => r.mediaGrade],
  ['Sleeve grade', (r) => r.sleeveGrade],
  ['Status', (r) => M.STATUS[r.status] || r.status],
  ['Asking price', (r) => r.askPrice],
  ['Discogs listing', (r) => r.listingId],
  ['Listing status', (r) => r.listingStatus],
  ['Sold price', (r) => r.soldPrice],
  ['Sold date', (r) => (r.soldAt ? new Date(r.soldAt).toISOString().slice(0, 10) : '')],
  ['Estimated value', (r) => { const v = M.estimate(r); return v == null ? '' : v.toFixed(2); }],
  ['Lowest for sale now', (r) => (r.market && r.market.lowest != null ? r.market.lowest : '')],
  ['Currency', (r) => (r.market && r.market.currency) || state.settings.currency],
  ['Loved tracks', (r) => (r.loved || []).map((k) => k.split('|').slice(1).join('|')).join('; ')],
  ['Notes', (r) => r.notes],
  ['Date added', (r) => (r.added ? new Date(r.added).toISOString().slice(0, 10) : '')],
  ['Discogs release ID', (r) => r.releaseId],
  ['Discogs collection ID', (r) => r.instanceId],
  ['Discogs link', (r) => M.discogsUrl(r)],
  ['Source', (r) => (r.source === 'manual' ? 'Added by hand' : 'Discogs')],
];

function cell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]/.test(s)) s = "'" + s; // stop spreadsheets running a note as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(records) {
  const rows = [COLUMNS.map((c) => cell(c[0])).join(',')];
  for (const r of records) rows.push(COLUMNS.map((c) => cell(c[1](r))).join(','));
  return '\ufeff' + rows.join('\r\n') + '\r\n';
}

// Share sheet on iPhone (Save to Files, AirDrop, Mail). Falls back to a normal download.
export async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'downloaded';
}

const today = () => new Date().toISOString().slice(0, 10);

export async function exportCsv() {
  const list = M.sortRecords([...state.records.values()], 'artist');
  const blob = new Blob([toCsv(list)], { type: 'text/csv' });
  return deliver(blob, `crate-collection-${today()}.csv`);
}

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

export async function backupJson() {
  const photos = {};
  for (const p of await allPhotos()) photos[p.id] = await toDataUrl(p.blob);
  const { token, spotify, spotifyQueue, ...settings } = state.settings; // sign in details are never written to a backup
  const data = { app: 'crate', version: 1, exportedAt: new Date().toISOString(), settings, records: [...state.records.values()], mixes: state.mixes, photos };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function exportBackup() {
  const blob = await backupJson();
  const res = await deliver(blob, `crate-backup-${today()}.json`);
  if (res !== 'cancelled') await saveSettings({ lastBackup: Date.now() });
  return res;
}

export async function restoreBackup(file) {
  const data = JSON.parse(await file.text());
  if (!data || data.app !== 'crate' || !Array.isArray(data.records)) throw new Error('That file is not a Crate backup.');
  for (const [id, url] of Object.entries(data.photos || {})) {
    const blob = await (await fetch(url)).blob();
    await putPhoto(id, blob);
  }
  await saveRecords(data.records);
  if (Array.isArray(data.mixes)) {
    const byId = new Map(state.mixes.map((m) => [m.id, m]));
    for (const m of data.mixes) byId.set(m.id, m);
    state.mixes = [...byId.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0));
    await saveMixes();
  }
  return data.records.length;
}
