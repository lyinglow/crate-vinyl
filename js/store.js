// Local storage. Everything lives on the phone, in IndexedDB.
// Three stores: records, photos (your own pictures), meta (settings).

const DB_NAME = 'crate';
const DB_VERSION = 1;

export const DEFAULTS = {
  token: '',
  username: '',
  currency: 'GBP',
  apiBase: 'https://api.discogs.com',
  mediaGrade: 'VG+',
  sleeveGrade: 'VG+',
  addToCollection: true,
  fetchPrices: true,
  fieldMap: null,
  sellerBlocked: false,
  lastBackup: 0,
  lastPriceRun: 0,
  view: 'grid',
  size: 3,
  worthMin: 30,
  collectionValue: null,
  spotifyClientId: '',
  spotifyAuthBase: '',
  spotifyApiBase: '',
  spotify: null,
  spotifyAuto: true,
  spotifyAll: true,
  bgStyle: 'soft',
  autoSpin: 2,
  digPassed: [],
  digHeard: {},
  spotifyPlaylists: {},
  spotifyQueue: [],
};

export const state = {
  records: new Map(),
  settings: { ...DEFAULTS },
  persisted: false,
  mixes: [],
  deviceId: '',
};

// Sync listens here. Each hook is set by cloud.js when sync is on, and is empty otherwise.
export const hooks = { record: null, recordDelete: null, photo: null, photoDelete: null, mixes: null, prefs: null, photoMissing: null };

let db = null;
const subs = new Set();

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function emit(kind, data) {
  for (const fn of [...subs]) {
    try { fn(kind, data); } catch (e) { console.error(e); }
  }
}

export function newId() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function os(name, mode = 'readonly') {
  return db.transaction(name, mode).objectStore(name);
}

function putMany(name, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const s = tx.objectStore(name);
    items.forEach((i) => s.put(i));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function init() {
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('records', { keyPath: 'id' });
      d.createObjectStore('photos', { keyPath: 'id' });
      d.createObjectStore('meta', { keyPath: 'key' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('Storage is blocked. Close other tabs of this app.'));
  });
  // A short name for this device, so two devices never both add the same record to Discogs.
  const dv = await req(os('meta').get('device'));
  if (dv && dv.value) state.deviceId = dv.value;
  else { state.deviceId = newId(); await req(os('meta', 'readwrite').put({ key: 'device', value: state.deviceId })); }
  const all = await req(os('records').getAll());
  for (const r of all) state.records.set(r.id, r);
  const s = await req(os('meta').get('settings'));
  if (s && s.value) Object.assign(state.settings, s.value);
  const mx = await req(os('meta').get('mixes'));
  state.mixes = (mx && mx.value) || [];
  try {
    if (navigator.storage && navigator.storage.persisted) {
      state.persisted = await navigator.storage.persisted();
      if (!state.persisted && navigator.storage.persist) {
        navigator.storage.persist().then((v) => { state.persisted = v; }).catch(() => {});
      }
    }
  } catch { /* not important */ }
}

// quiet = true means "do not redraw the library". Used by background sync.
export async function saveRecord(rec, { quiet = false } = {}) {
  rec.updated = Date.now();
  if (!rec.origin) rec.origin = state.deviceId;
  state.records.set(rec.id, rec);
  await req(os('records', 'readwrite').put(rec));
  if (hooks.record) hooks.record([rec]);
  emit(quiet ? 'quiet' : 'records', rec);
  return rec;
}

export async function saveRecords(list) {
  const now = Date.now();
  list.forEach((r) => { r.updated = now; if (!r.origin) r.origin = state.deviceId; state.records.set(r.id, r); });
  await putMany('records', list);
  if (hooks.record) hooks.record(list);
  emit('records');
}

export async function deleteRecord(id) {
  const r = state.records.get(id);
  state.records.delete(id);
  await req(os('records', 'readwrite').delete(id));
  if (r) for (const p of [r.photoSleeve, r.photoLabel]) if (p) await delPhoto(p);
  if (hooks.recordDelete) hooks.recordDelete(id);
  emit('records');
}

export async function getMeta(key) {
  const r = await req(os('meta').get(key));
  return r ? r.value : undefined;
}

export async function setMeta(key, value) {
  await req(os('meta', 'readwrite').put({ key, value }));
}

export async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await req(os('meta', 'readwrite').put({ key: 'settings', value: state.settings }));
  if (hooks.prefs) hooks.prefs(Object.keys(patch));
  emit('settings');
}

export async function saveMixes() {
  await req(os('meta', 'readwrite').put({ key: 'mixes', value: state.mixes }));
  if (hooks.mixes) hooks.mixes();
  emit('mixes');
}

// Changes that arrive from the cloud. They are written down without being marked as new local changes,
// so they are not sent straight back.
export async function applyRemote({ records = [], removed = [], mixes = null, prefs = null } = {}) {
  if (records.length) {
    records.forEach((r) => state.records.set(r.id, r));
    await putMany('records', records);
  }
  for (const id of removed) {
    const r = state.records.get(id);
    state.records.delete(id);
    await req(os('records', 'readwrite').delete(id));
    if (r) for (const p of [r.photoSleeve, r.photoLabel]) if (p) await delPhoto(p, { remote: true });
  }
  if (mixes) {
    state.mixes = mixes;
    await req(os('meta', 'readwrite').put({ key: 'mixes', value: state.mixes }));
    emit('mixes');
  }
  if (prefs) {
    Object.assign(state.settings, prefs);
    await req(os('meta', 'readwrite').put({ key: 'settings', value: state.settings }));
    emit('settings');
  }
  if (records.length || removed.length) emit('records');
}

export async function wipeAll() {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['records', 'photos', 'meta'], 'readwrite');
    tx.objectStore('records').clear();
    tx.objectStore('photos').clear();
    tx.objectStore('meta').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  state.records.clear();
  state.mixes = [];
  state.settings = { ...DEFAULTS };
  urlCache.clear();
  emit('records');
  emit('settings');
}

// ---- photos ----
const urlCache = new Map();

export async function putPhoto(id, blob, { remote = false } = {}) {
  await req(os('photos', 'readwrite').put({ id, blob }));
  urlCache.delete(id);
  if (!remote && hooks.photo) hooks.photo(id);
}

export async function getPhoto(id) {
  const r = await req(os('photos').get(id));
  if (r) return r.blob;
  // Not on this device yet. If sync is on, fetch it from the cloud and keep it.
  if (hooks.photoMissing) {
    try {
      const b = await hooks.photoMissing(id);
      if (b) { await putPhoto(id, b, { remote: true }); return b; }
    } catch { /* offline: show the placeholder */ }
  }
  return null;
}

export async function delPhoto(id, { remote = false } = {}) {
  await req(os('photos', 'readwrite').delete(id));
  const u = urlCache.get(id);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(id);
  if (!remote && hooks.photoDelete) hooks.photoDelete(id);
}

export async function allPhotos() {
  return req(os('photos').getAll());
}

export async function photoUrl(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getPhoto(id);
  if (!blob) return '';
  const u = URL.createObjectURL(blob);
  urlCache.set(id, u);
  return u;
}
