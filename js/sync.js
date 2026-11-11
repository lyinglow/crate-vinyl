// Background work with Discogs. Each record carries its own to-do state, so if you
// close the app halfway, it picks up where it stopped.
//   collAdd  put the record in your Discogs collection
//   detail   fetch tracklist, images, pressing details
//   fields   write your condition grades and notes to Discogs
//   price    fetch price suggestions
import { state, saveRecord, saveRecords, saveSettings, emit, deleteRecord } from './store.js';
import { D, ApiError } from './discogs.js';
import * as M from './model.js';
import * as SP from './spotify.js';

export const status = { running: false, paused: false, pending: 0, label: '', error: '' };

const failed = new Set();
const STALE_MS = 30 * 864e5;
let looping = false;
let timer = null;
let sugFails = 0;

function setStatus(patch) {
  Object.assign(status, patch);
  emit('sync');
}

export function needsPrice(r) {
  if (!state.settings.fetchPrices) return false;
  if (r.status === 'sold' || r.source !== 'discogs' || !r.releaseId) return false;
  const m = r.market;
  return !m || !m.updated || Date.now() - m.updated > STALE_MS;
}

function tasksFor(r) {
  const s = state.settings;
  const out = [];
  if (r.source !== 'discogs' || !r.releaseId) return out;
  if (r.wanted) {
    // A record you want: put it on your Discogs wantlist and get its details. Nothing else.
    if (s.username && s.addToWantlist !== false && !r.wantSynced && !r.noWant) out.push(['wantAdd', 1]);
    if (r.wantDetail && !r.detail) out.push(['detail', 2]);
    if (needsPrice(r)) out.push(['price', 5]); // the cheapest copy for sale, to show on the wanted list
    return out.filter(([k]) => !failed.has(`${r.id}:${k}`));
  }
  const live = r.status !== 'sold';
  if (s.addToCollection && s.username && live && !r.instanceId && !r.noCollection) out.push(['collAdd', 1]);
  if (r.wantDetail && !r.detail) out.push(['detail', 2]);
  if (r.instanceId && r.fieldsDirty && s.username) out.push(['fields', 3]);
  if (needsPrice(r)) out.push(['price', 5]);
  return out.filter(([k]) => !failed.has(`${r.id}:${k}`));
}

function scan() {
  let best = null;
  let count = 0;
  let priceCount = 0;
  for (const r of state.records.values()) {
    for (const [kind, p] of tasksFor(r)) {
      count++;
      if (kind === 'price') priceCount++;
      if (!best || p < best.p) best = { rec: r, kind, p };
    }
  }
  return { best, count, priceCount };
}

export function pendingCount() {
  return scan().count;
}

export function pendingPrices() {
  return scan().priceCount;
}

const LABELS = {
  collAdd: 'Adding to your Discogs collection',
  wantAdd: 'Adding to your Discogs wantlist',
  detail: 'Getting pressing details',
  fields: 'Saving your grades to Discogs',
  price: 'Checking prices',
};

export function kick() {
  if (looping || status.paused) return;
  loop();
}

export function pause() { setStatus({ paused: true }); }
export function resume() { setStatus({ paused: false, error: '' }); failed.clear(); kick(); }

async function loop() {
  looping = true;
  clearTimeout(timer);
  setStatus({ running: true, error: '' });
  try {
    while (!status.paused) {
      const s = state.settings;
      if (!s.token || !s.username) break;
      if (navigator.onLine === false) { setStatus({ error: 'Offline. Sync carries on when you are back.' }); break; }
      const { best, count } = scan();
      status.pending = count;
      if (!best) break;
      setStatus({ label: LABELS[best.kind] });
      try {
        await runTask(best.rec, best.kind);
      } catch (e) {
        if (e && e.status === 401) { setStatus({ error: 'Discogs did not accept your token.' }); break; }
        if (e && e.status === 0) { setStatus({ error: e.message }); timer = setTimeout(kick, 30000); break; }
        failed.add(`${best.rec.id}:${best.kind}`);
        if (best.kind === 'collAdd') { best.rec.noCollection = true; best.rec.syncNote = e.message; }
        if (best.kind === 'wantAdd') { best.rec.noWant = true; best.rec.syncNote = e.message; }
        if (best.kind === 'detail') best.rec.wantDetail = false;
        if (state.records.has(best.rec.id)) await saveRecord(best.rec, { quiet: true });
        console.warn('Sync task failed', best.kind, e);
      }
    }
  } finally {
    looping = false;
    setStatus({ running: false, label: '', pending: pendingCount() });
  }
}

async function runTask(rec, kind) {
  const u = state.settings.username;
  if (kind === 'wantAdd') {
    await D.wantAdd(u, rec.releaseId);
    rec.wantSynced = true;
  } else if (kind === 'collAdd') {
    const res = await D.collectionAdd(u, rec.releaseId, 1);
    if (!state.records.has(rec.id)) {
      // Deleted while we were adding. Undo it on Discogs.
      try { await D.collectionRemove(u, 1, rec.releaseId, res.instance_id); } catch { /* ignore */ }
      return;
    }
    rec.instanceId = res.instance_id;
    rec.folderId = 1;
    rec.fieldsDirty = true;
  } else if (kind === 'detail') {
    const rel = await D.release(rec.releaseId, 2);
    M.applyRelease(rec, rel, state.settings.currency);
    if (state.records.has(rec.id)) { await saveRecord(rec, { quiet: true }); if (!rec.wanted) SP.enqueueRecord(rec); } // a new vinyl: its tracks go to Spotify too
  } else if (kind === 'fields') {
    await pushFields(rec);
  } else if (kind === 'price') {
    await fetchMarket(rec, 5, !!rec.wanted);
  }
  if (state.records.has(rec.id)) await saveRecord(rec, { quiet: true });
}

// ---------- Discogs collection fields (grades and notes) ----------

export async function ensureFieldMap() {
  const s = state.settings;
  if (s.fieldMap) return s.fieldMap;
  const res = await D.collectionFields(s.username);
  const map = {};
  for (const f of res.fields || []) {
    const n = String(f.name).toLowerCase();
    if (n === 'media condition') map.media = f.id;
    else if (n === 'sleeve condition') map.sleeve = f.id;
    else if (n === 'notes') map.notes = f.id;
  }
  await saveSettings({ fieldMap: map });
  return map;
}

async function pushFields(rec) {
  const s = state.settings;
  const map = await ensureFieldMap();
  rec.fieldsDirty = false;
  const put = (fid, v) => D.setField(s.username, rec.folderId || 1, rec.releaseId, rec.instanceId, fid, v);
  try {
    if (rec.mediaGrade && map.media) await put(map.media, M.gradeName(rec.mediaGrade));
    if (rec.sleeveGrade && map.sleeve) await put(map.sleeve, M.gradeName(rec.sleeveGrade));
    if (rec.notes && map.notes) await put(map.notes, rec.notes);
  } catch (e) {
    if (e.status === 0 || e.status === 401 || e.status === 429) rec.fieldsDirty = true;
    throw e;
  }
}

// ---------- prices ----------

export async function fetchMarket(rec, priority = 5, withStats = false) {
  const s = state.settings;
  const m = rec.market || (rec.market = {});
  let sug = null;
  if (!s.sellerBlocked) {
    try {
      const res = await D.priceSuggestions(rec.releaseId, priority);
      const out = {};
      let cur = null;
      for (const [name, v] of Object.entries(res || {})) {
        const code = M.gradeCode(name);
        if (code && v && typeof v.value === 'number') { out[code] = v.value; cur = v.currency || cur; }
      }
      if (Object.keys(out).length) { sug = out; m.currency = cur || m.currency || s.currency; sugFails = 0; }
    } catch (e) {
      if (e.status === 0 || e.status === 401 || e.status === 429) throw e;
      sugFails++;
      if (/seller/i.test(e.message || '') || sugFails >= 6) await saveSettings({ sellerBlocked: true });
    }
  }
  m.suggestions = sug;
  if (withStats || !sug) {
    try {
      const st = await D.stats(rec.releaseId, priority);
      if (st) {
        m.lowest = st.lowest_price ? st.lowest_price.value : null;
        if (st.lowest_price) m.currency = st.lowest_price.currency || m.currency || s.currency;
        m.numForSale = st.num_for_sale;
      }
    } catch (e) {
      if (e.status === 0 || e.status === 401 || e.status === 429) throw e;
    }
  }
  m.updated = Date.now();
  return rec;
}

export async function refreshMarket(rec) {
  await fetchMarket(rec, 0, true);
  await saveRecord(rec, { quiet: true });
  return rec;
}

export async function ensureDetail(rec) {
  if (rec.source !== 'discogs' || !rec.releaseId) return rec;
  if (rec.detail && Array.isArray(rec.videos)) return rec;
  const rel = await D.release(rec.releaseId, 0);
  M.applyRelease(rec, rel, state.settings.currency);
  await saveRecord(rec, { quiet: true });
  return rec;
}

// Make every record due for a new price check, then start.
export async function refreshAllPrices() {
  const list = [];
  for (const r of state.records.values()) {
    if (r.source === 'discogs' && r.releaseId && r.status !== 'sold') {
      r.market = r.market || {};
      r.market.updated = 0;
      list.push(r);
    }
  }
  await saveRecords(list);
  await saveSettings({ lastPriceRun: Date.now(), sellerBlocked: false });
  failed.clear();
  kick();
}

// ---------- import your existing Discogs collection ----------

export async function importCollection(onProgress) {
  const u = state.settings.username;
  if (!u) throw new ApiError(401, 'Connect Discogs first.');
  let map = null;
  try { map = await ensureFieldMap(); } catch { /* grades will be blank */ }
  const have = new Set([...state.records.values()].map((r) => r.instanceId).filter(Boolean));
  let page = 1;
  let pages = 1;
  let added = 0;
  let total = 0;
  do {
    const res = await D.collectionPage(u, page, 100);
    pages = (res.pagination && res.pagination.pages) || 1;
    total = (res.pagination && res.pagination.items) || total;
    const fresh = [];
    for (const item of res.releases || []) {
      if (have.has(item.instance_id)) continue;
      have.add(item.instance_id);
      fresh.push(M.fromCollectionItem(item, map));
    }
    if (fresh.length) await saveRecords(fresh);
    added += fresh.length;
    if (onProgress) onProgress({ page, pages, added, total });
    page++;
  } while (page <= pages);
  return { added, total };
}

// ---------- selling ----------

export async function removeFromCollection(rec) {
  if (!rec.instanceId) return;
  try {
    await D.collectionRemove(state.settings.username, rec.folderId || 1, rec.releaseId, rec.instanceId);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  rec.instanceId = null;
  rec.needsCollRemoval = false;
  rec.noCollection = true;
  await saveRecord(rec);
}

export async function deleteListing(rec) {
  if (!rec.listingId) return;
  try {
    await D.listingDelete(rec.listingId);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  rec.listingStatus = 'Deleted';
}

export async function checkListings() {
  const recs = [...state.records.values()].filter((r) => r.listingId && r.status === 'for_sale');
  let sold = 0;
  let changed = 0;
  for (const r of recs) {
    try {
      const l = await D.listingGet(r.listingId);
      if (l.status === 'Sold') {
        r.status = 'sold';
        r.listingStatus = 'Sold';
        r.soldAt = r.soldAt || Date.now();
        r.soldPrice = l.price && l.price.value != null ? l.price.value : r.askPrice;
        r.needsCollRemoval = !!r.instanceId;
        sold++;
      } else if (l.status !== r.listingStatus) {
        r.listingStatus = l.status;
        changed++;
      }
    } catch (e) {
      if (e.status === 404) { r.listingStatus = 'Not found'; changed++; } else throw e;
    }
    await saveRecord(r);
  }
  return { checked: recs.length, sold, changed };
}

// A wanted record you have now found: it joins your collection, and leaves your Discogs wantlist.
export async function gotIt(rec) {
  const u = state.settings.username;
  const wasSynced = rec.wantSynced;
  rec.wanted = false;
  rec.status = 'keeping';
  rec.mediaGrade = rec.mediaGrade || state.settings.mediaGrade;
  rec.sleeveGrade = rec.sleeveGrade || state.settings.sleeveGrade;
  rec.noCollection = false;
  rec.fieldsDirty = true;
  rec.wantSynced = false;
  rec.added = Date.now();
  await saveRecord(rec);
  if (wasSynced && u && rec.releaseId) D.wantRemove(u, rec.releaseId).catch(() => {});
  if (rec.detail) SP.enqueueRecord(rec);
  kick();
}

// Take a record off the wanted list for good.
export async function removeWanted(rec) {
  const u = state.settings.username;
  if (rec.wantSynced && u && rec.releaseId) { try { await D.wantRemove(u, rec.releaseId); } catch { /* it can stay on Discogs */ } }
  await deleteRecord(rec.id);
}
