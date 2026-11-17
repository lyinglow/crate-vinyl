// Sync across devices, through your own Supabase project.
// Email and password sign in. Your records, mixes and settings go to one table. Photos go to private storage.
// The newest change to a record wins. Deleting on one device deletes everywhere.
// Your Discogs token and Spotify keys never leave the device.
import { state, hooks, getMeta, setMeta, applyRemote, getPhoto, emit } from './store.js';

const KEY = 'cloud';
const BUCKET = 'crate-photos';
const PAGE = 500;
const PUSH_BATCH = 100;

// Settings that follow you. Anything with a key or a token in it is left out on purpose.
export const PREF_KEYS = ['currency', 'mediaGrade', 'sleeveGrade', 'view', 'size', 'worthMin', 'bgStyle', 'autoSpin', 'digPassed', 'digHeard', 'spotifyAuto', 'spotifyAll', 'fetchPrices', 'addToCollection'];

const cloud = { url: '', anon: '', session: null, cursor: '', dirty: {}, tomb: {}, docTs: {}, photoDirty: {}, photoDel: {}, firstDone: false, lastSync: 0 };
export const status = { configured: false, signedIn: false, email: '', busy: false, stage: '', error: '', info: '', lastSync: 0, pending: 0, recovery: false };

let saveTimer = null;
let syncTimer = null;
let loopTimer = null;
let running = null;

const now = () => Date.now();
const on = () => !!(cloud.url && cloud.anon && cloud.session && cloud.session.user);

function refreshStatus() {
  status.configured = !!(cloud.url && cloud.anon);
  status.signedIn = on();
  status.email = (cloud.session && cloud.session.user && cloud.session.user.email) || '';
  status.lastSync = cloud.lastSync;
  status.pending = Object.keys(cloud.dirty).length + Object.keys(cloud.tomb).length + Object.keys(cloud.photoDirty).length + Object.keys(cloud.photoDel).length;
  emit('cloud');
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { setMeta(KEY, cloud).catch(() => {}); }, 400);
  refreshStatus();
}

export async function load() {
  const saved = await getMeta(KEY);
  if (saved && typeof saved === 'object') Object.assign(cloud, saved);
  attach();
  refreshStatus();
  if (on()) startLoop();
}

// ---------------------------------------------------------------- setting up

export function configure(url, anon) {
  let u = String(url || '').trim().replace(/\/+$/, '');
  const k = String(anon || '').trim();
  if (!/^https:\/\/[^\s/]+$/i.test(u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(u)) throw new Error('That does not look like a Supabase project address. It starts with https:// and ends with .supabase.co');
  if (k.length < 20) throw new Error('That key looks too short. Copy the whole public key.');
  if (cloud.url !== u) { cloud.session = null; cloud.cursor = ''; cloud.firstDone = false; }
  cloud.url = u;
  cloud.anon = k;
  persist();
}

// Forget the project on this device. Your data stays on the device and in Supabase.
export function forget() {
  clearTimeout(syncTimer);
  clearInterval(loopTimer);
  Object.assign(cloud, { url: '', anon: '', session: null, cursor: '', dirty: {}, tomb: {}, docTs: {}, photoDirty: {}, photoDel: {}, firstDone: false, lastSync: 0 });
  status.error = ''; status.info = '';
  persist();
}

// The sign in token, for asking your own server for things. Empty if you are not signed in.
export async function accessToken() {
  if (!on()) return '';
  try { await ensureToken(); } catch { return ''; }
  return cloud.session.access_token;
}

export const isConfigured = () => !!(cloud.url && cloud.anon);
export const projectUrl = () => cloud.url;

// A link that sets up another device in one tap. It holds only the project address and the public key.
export function setupLink() {
  const raw = JSON.stringify({ u: cloud.url, k: cloud.anon });
  return `${location.origin}/#/cloud/${btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

export function applySetupLink(code) {
  const b = String(code || '').replace(/-/g, '+').replace(/_/g, '/');
  const o = JSON.parse(atob(b + '='.repeat((4 - (b.length % 4)) % 4)));
  configure(o.u, o.k);
}

// ---------------------------------------------------------------- signing in

async function authCall(path, body, method = 'POST', token = '') {
  let r;
  try {
    r = await fetch(`${cloud.url}/auth/v1/${path}`, { method, headers: { apikey: cloud.anon, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Could not reach Supabase. Check your connection.'); }
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) throw new Error(j.msg || j.error_description || j.message || j.error || `Supabase answered ${r.status}.`);
  return j;
}

function takeSession(j) {
  if (!j || !j.access_token) return false;
  cloud.session = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at ? j.expires_at * 1000 : now() + (Number(j.expires_in) || 3600) * 1000, user: j.user || (cloud.session && cloud.session.user) };
  return true;
}

export async function signUp(email, password) {
  let j;
  try {
    j = await authCall('signup', { email: String(email).trim(), password });
  } catch (e) {
    if (/already registered|already been registered/i.test(e.message)) throw new Error('That email already has an account. Tap Sign in with its password. If you cannot remember it, tap Forgot password.');
    throw e;
  }
  if (takeSession(j)) { persist(); start(); return 'in'; }
  persist();
  return 'confirm'; // Supabase wants the email confirmed first
}

export async function signIn(email, password) {
  let j;
  try {
    j = await authCall('token?grant_type=password', { email: String(email).trim(), password });
  } catch (e) {
    if (/invalid login credentials/i.test(e.message)) throw new Error('That email and password do not match an account. If this is your first time, tap Create account, not Sign in.');
    throw e;
  }
  if (!takeSession(j)) throw new Error('Supabase did not sign you in.');
  persist();
  start();
}

export async function signOut() {
  clearTimeout(syncTimer);
  clearInterval(loopTimer);
  if (cloud.session && cloud.url) authCall('logout', null, 'POST', cloud.session.access_token).catch(() => {});
  cloud.session = null;
  cloud.firstDone = false; // the next sign in checks everything again
  cloud.cursor = '';
  status.error = '';
  status.info = '';
  persist();
}

export async function recover(email) {
  await authCall('recover', { email: String(email).trim(), redirect_to: `${location.origin}/` });
}

export async function setPassword(password) {
  await ensureToken();
  await authCall('user', { password }, 'PUT', cloud.session.access_token);
  status.recovery = false;
  refreshStatus();
}

// The email link that resets a password lands here, with the session in the address.
export function takeRecoveryFromHash() {
  const h = location.hash || '';
  if (!/type=recovery/.test(h) || !/access_token=/.test(h)) return false;
  const p = new URLSearchParams(h.replace(/^#\/?/, ''));
  if (!cloud.url || !p.get('access_token')) return false;
  takeSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in') });
  status.recovery = true;
  persist();
  history.replaceState(null, '', '#/settings');
  return true;
}

async function ensureToken(force = false) {
  const s = cloud.session;
  if (!s) throw new Error('Please sign in again.');
  if (!force && s.expires_at - 90000 > now()) return;
  let j;
  try {
    j = await authCall('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
  } catch (e) {
    if (/reach/i.test(e.message)) throw e;
    cloud.session = null;
    persist();
    throw new Error('Please sign in again.');
  }
  takeSession(j);
  persist();
}

async function authed(path, init = {}) {
  await ensureToken();
  const go = () => fetch(`${cloud.url}${path}`, { ...init, headers: { apikey: cloud.anon, Authorization: `Bearer ${cloud.session.access_token}`, ...(init.headers || {}) } });
  let r;
  try { r = await go(); } catch { throw new Error('Could not reach Supabase. Check your connection.'); }
  if (r.status === 401) {
    await ensureToken(true);
    r = await go();
  }
  return r;
}

// ---------------------------------------------------------------- what changed here

function mark(key, ts) {
  if (!on()) return;
  cloud.dirty[key] = ts || now();
  delete cloud.tomb[key];
  schedule();
}

function attach() {
  hooks.record = (list) => { if (!on()) return; for (const r of list) cloud.dirty[`record:${r.id}`] = r.updated || now(), delete cloud.tomb[`record:${r.id}`]; schedule(); persist(); };
  hooks.recordDelete = (id) => { if (!on()) return; delete cloud.dirty[`record:${id}`]; cloud.tomb[`record:${id}`] = now(); schedule(); persist(); };
  hooks.photo = (id) => { if (!on()) return; cloud.photoDirty[id] = 1; delete cloud.photoDel[id]; schedule(); persist(); };
  hooks.photoDelete = (id) => { if (!on()) return; delete cloud.photoDirty[id]; cloud.photoDel[id] = 1; schedule(); persist(); };
  hooks.history = () => { if (!on()) return; cloud.docTs['history:all'] = now(); mark('history:all', cloud.docTs['history:all']); persist(); };
  hooks.equipment = () => { if (!on()) return; cloud.docTs['equipment:all'] = now(); mark('equipment:all', cloud.docTs['equipment:all']); persist(); };
  hooks.mixes = () => { if (!on()) return; cloud.docTs['mixes:all'] = now(); mark('mixes:all', cloud.docTs['mixes:all']); persist(); };
  hooks.prefs = (keys) => { if (!on() || !keys.some((k) => PREF_KEYS.includes(k))) return; cloud.docTs['prefs:all'] = now(); mark('prefs:all', cloud.docTs['prefs:all']); persist(); };
  hooks.photoMissing = async (id) => {
    if (!on()) return null;
    const r = await authed(`/storage/v1/object/authenticated/${BUCKET}/${cloud.session.user.id}/${encodeURIComponent(id)}`);
    return r.ok ? r.blob() : null;
  };
}

function schedule(ms = 4000) {
  clearTimeout(syncTimer);
  if (!on()) return;
  syncTimer = setTimeout(() => { syncNow(); }, ms);
}

// ---------------------------------------------------------------- syncing

const prefsNow = () => Object.fromEntries(PREF_KEYS.filter((k) => k in state.settings).map((k) => [k, state.settings[k]]));

async function pull() {
  let cursor = cloud.cursor;
  const first = !cloud.firstDone;
  for (let guard = 0; guard < 400; guard++) {
    const q = new URLSearchParams({ select: 'kind,id,data,deleted,updated_at', order: 'updated_at.asc,kind.asc,id.asc', limit: String(PAGE) });
    if (cursor) q.set('updated_at', `gte.${cursor}`);
    const r = await authed(`/rest/v1/crate_docs?${q}`);
    if (!r.ok) throw new Error(await explain(r, 'read'));
    const rows = await r.json();
    const put = [];
    const gone = [];
    let mixes = null;
    let gear = null;
    let hist = null;
    let prefs = null;
    for (const row of rows) {
      const key = `${row.kind}:${row.id}`;
      const at = Date.parse(row.updated_at) || 0;
      if (row.kind === 'record') {
        const local = state.records.get(row.id);
        const tomb = cloud.tomb[key];
        if (row.deleted) {
          if (tomb) { delete cloud.tomb[key]; continue; }
          if (!local) continue;
          if (cloud.dirty[key] && local.updated > at) continue; // changed here after it was deleted there
          gone.push(row.id);
          delete cloud.dirty[key];
        } else if (row.data) {
          const inc = row.data;
          if (tomb && tomb > (inc.updated || 0)) continue; // deleted here more recently
          if (tomb) delete cloud.tomb[key];
          if (local && (inc.updated || 0) <= (local.updated || 0)) {
            if ((inc.updated || 0) < (local.updated || 0)) cloud.dirty[key] = local.updated; // ours is newer, send it
            else delete cloud.dirty[key]; // the same version is already up there
            continue;
          }
          put.push(inc);
          delete cloud.dirty[key];
        }
      } else if (row.kind === 'mixes' && row.data) {
        const ts = row.data.ts || at;
        const mine = cloud.docTs[key] || 0;
        if (first && state.mixes.length) {
          // The first time, keep mixes from both sides.
          const by = new Map((row.data.mixes || []).map((m) => [m.id, m]));
          for (const m of state.mixes) if (!by.has(m.id) || (m.updated || 0) > (by.get(m.id).updated || 0)) by.set(m.id, m);
          mixes = [...by.values()].sort((a, b) => (b.updated || 0) - (a.updated || 0));
          cloud.dirty[key] = now(); cloud.docTs[key] = now();
        } else if (ts > mine) { mixes = row.data.mixes || []; cloud.docTs[key] = ts; delete cloud.dirty[key]; }
        else if (ts < mine) cloud.dirty[key] = mine;
      } else if (row.kind === 'history' && row.data) {
        // One entry a day. Where both sides have a day, the one with more records priced is kept.
        const ts = row.data.ts || at;
        const mine = cloud.docTs[key] || 0;
        const by = new Map((row.data.items || []).map((x) => [x.d, x]));
        let changed = false;
        for (const x of state.history) {
          const o = by.get(x.d);
          if (!o || (x.priced || 0) > (o.priced || 0) || ((x.priced || 0) === (o.priced || 0) && (x.t || 0) > (o.t || 0))) { by.set(x.d, x); changed = changed || !o || o !== x; }
        }
        const merged = [...by.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
        if (JSON.stringify(merged) !== JSON.stringify(state.history)) hist = merged;
        if (changed) { cloud.dirty[key] = now(); cloud.docTs[key] = now(); } else if (ts >= mine) { delete cloud.dirty[key]; cloud.docTs[key] = ts; }
      } else if (row.kind === 'equipment' && row.data) {
        const ts = row.data.ts || at;
        const mine = cloud.docTs[key] || 0;
        if (first && state.equipment.length) {
          const by = new Map((row.data.items || []).map((g) => [g.id, g]));
          for (const g of state.equipment) if (!by.has(g.id) || (g.updated || 0) > (by.get(g.id).updated || 0)) by.set(g.id, g);
          gear = [...by.values()];
          cloud.dirty[key] = now(); cloud.docTs[key] = now();
        } else if (ts > mine) { gear = row.data.items || []; cloud.docTs[key] = ts; delete cloud.dirty[key]; }
        else if (ts < mine) cloud.dirty[key] = mine;
      } else if (row.kind === 'prefs' && row.data) {
        const ts = row.data.ts || at;
        const mine = cloud.docTs[key] || 0;
        if (ts > mine) { prefs = row.data.prefs || {}; cloud.docTs[key] = ts; delete cloud.dirty[key]; }
        else if (ts < mine) cloud.dirty[key] = mine;
      }
    }
    if (put.length || gone.length || mixes || gear || hist || prefs) await applyRemote({ records: put, removed: gone, mixes, equipment: gear, history: hist, prefs });
    const last = rows.length ? rows[rows.length - 1].updated_at : cursor;
    const moved = last !== cursor;
    cursor = last || cursor;
    cloud.cursor = cursor || '';
    persist();
    if (rows.length < PAGE || !moved) break;
    status.stage = `Downloading... ${((guard + 1) * PAGE).toLocaleString('en-GB')} so far`;
    refreshStatus();
  }
}

async function push() {
  const uid = cloud.session.user.id;
  const keys = Object.keys(cloud.dirty);
  const docs = [];
  for (const key of keys) {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    const ts = cloud.dirty[key];
    if (kind === 'record') {
      const rec = state.records.get(id);
      if (rec) docs.push({ key, ts, row: { user_id: uid, kind, id, data: rec, deleted: false } });
      else delete cloud.dirty[key];
    } else if (kind === 'history') docs.push({ key, ts, row: { user_id: uid, kind, id, data: { ts: cloud.docTs[key] || ts, items: state.history }, deleted: false } });
    else if (kind === 'equipment') docs.push({ key, ts, row: { user_id: uid, kind, id, data: { ts: cloud.docTs[key] || ts, items: state.equipment }, deleted: false } });
    else if (kind === 'mixes') docs.push({ key, ts, row: { user_id: uid, kind, id, data: { ts: cloud.docTs[key] || ts, mixes: state.mixes }, deleted: false } });
    else if (kind === 'prefs') docs.push({ key, ts, row: { user_id: uid, kind, id, data: { ts: cloud.docTs[key] || ts, prefs: prefsNow() }, deleted: false } });
  }
  for (const key of Object.keys(cloud.tomb)) {
    const id = key.slice('record:'.length);
    docs.push({ key, ts: cloud.tomb[key], tomb: true, row: { user_id: uid, kind: 'record', id, data: null, deleted: true } });
  }
  for (let i = 0; i < docs.length; i += PUSH_BATCH) {
    const batch = docs.slice(i, i + PUSH_BATCH);
    const r = await authed('/rest/v1/crate_docs?on_conflict=user_id,kind,id', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch.map((b) => b.row)) });
    if (!r.ok) throw new Error(await explain(r, 'save'));
    for (const b of batch) {
      if (b.tomb) { if (cloud.tomb[b.key] === b.ts) delete cloud.tomb[b.key]; } else if (cloud.dirty[b.key] === b.ts) delete cloud.dirty[b.key];
    }
    status.stage = `Uploading... ${Math.min(docs.length, i + PUSH_BATCH).toLocaleString('en-GB')} of ${docs.length.toLocaleString('en-GB')}`;
    persist();
  }
}

async function photos() {
  const uid = cloud.session.user.id;
  for (const id of Object.keys(cloud.photoDirty)) {
    const blob = await getPhoto(id).catch(() => null);
    if (!blob) { delete cloud.photoDirty[id]; continue; }
    const r = await authed(`/storage/v1/object/${BUCKET}/${uid}/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': blob.type || 'image/jpeg', 'x-upsert': 'true' }, body: blob });
    if (!r.ok) throw new Error(await explain(r, 'upload a photo'));
    delete cloud.photoDirty[id];
    persist();
  }
  for (const id of Object.keys(cloud.photoDel)) {
    await authed(`/storage/v1/object/${BUCKET}/${uid}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
    delete cloud.photoDel[id];
  }
}

async function explain(r, doing) {
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  const m = j.message || j.msg || j.error || '';
  if (r.status === 404 || /relation .* does not exist|crate_docs/i.test(m)) return 'The database is not set up yet. Run the setup script in Supabase (see the steps in Settings).';
  if (r.status === 401 || r.status === 403) return `Supabase would not let this account ${doing}. Sign in again.`;
  return `Could not ${doing}. ${m || `Supabase answered ${r.status}.`}`;
}

// Everything in one go: fetch what is new, send what changed, move photos.
export function syncNow() {
  if (!on()) return Promise.resolve();
  if (running) return running;
  clearTimeout(syncTimer);
  running = (async () => {
    status.busy = true; status.error = ''; status.stage = 'Checking...'; refreshStatus();
    try {
      if (!cloud.firstDone) {
        // First time on this device: everything here is offered to the cloud, and the cloud's newer versions win.
        for (const id of state.records.keys()) cloud.dirty[`record:${id}`] = cloud.dirty[`record:${id}`] || state.records.get(id).updated || now();
        if (state.mixes.length) cloud.dirty['mixes:all'] = cloud.dirty['mixes:all'] || now();
        if (state.history.length) cloud.dirty['history:all'] = cloud.dirty['history:all'] || now();
        if (state.equipment.length) cloud.dirty['equipment:all'] = cloud.dirty['equipment:all'] || now();
        for (const g of state.equipment) if (g.photo) cloud.photoDirty[g.photo] = 1;
        if (!cloud.docTs['prefs:all']) cloud.dirty['prefs:all'] = now(); // if the cloud has settings already, those win
        for (const k of ['photoSleeve', 'photoLabel']) for (const r of state.records.values()) if (r[k]) cloud.photoDirty[r[k]] = 1;
      }
      await pull();
      cloud.firstDone = true;
      await push();
      await photos();
      cloud.lastSync = now();
      status.stage = '';
    } catch (e) {
      status.error = e && e.message ? e.message : 'Sync stopped.';
      status.stage = '';
      if (/sign in again/i.test(status.error)) { clearInterval(loopTimer); }
    } finally {
      status.busy = false;
      running = null;
      persist();
    }
  })();
  return running;
}

function startLoop() {
  clearInterval(loopTimer);
  loopTimer = setInterval(() => { if (!document.hidden && navigator.onLine !== false) syncNow(); }, 60000);
}

// Called when you sign in, and when the app opens already signed in.
export function start() {
  if (!on()) return;
  startLoop();
  syncNow();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (on()) schedule(500); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && on()) schedule(800); });
}

// ---------------------------------------------------------------- the database script

export const SETUP_SQL = `-- Crate sync. Run this once in Supabase: SQL Editor, New query, paste, Run.
create table if not exists public.crate_docs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null,
  id text not null,
  data jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, id)
);
create index if not exists crate_docs_updated on public.crate_docs (user_id, updated_at);
alter table public.crate_docs enable row level security;
drop policy if exists "crate own rows" on public.crate_docs;
create policy "crate own rows" on public.crate_docs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create or replace function public.crate_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists crate_touch on public.crate_docs;
create trigger crate_touch before insert or update on public.crate_docs for each row execute function public.crate_touch();

insert into storage.buckets (id, name, public) values ('crate-photos', 'crate-photos', false) on conflict (id) do nothing;
drop policy if exists "crate photos read" on storage.objects;
drop policy if exists "crate photos write" on storage.objects;
drop policy if exists "crate photos change" on storage.objects;
drop policy if exists "crate photos delete" on storage.objects;
create policy "crate photos read" on storage.objects for select using (bucket_id = 'crate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "crate photos write" on storage.objects for insert with check (bucket_id = 'crate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "crate photos change" on storage.objects for update using (bucket_id = 'crate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "crate photos delete" on storage.objects for delete using (bucket_id = 'crate-photos' and (storage.foldername(name))[1] = auth.uid()::text);
`;
