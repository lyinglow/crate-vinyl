// Spotify: sign in, find each track on Spotify, and fill playlists.
//   "Crate loved": every track you heart.
//   "Crate collection": every track of each record you add (a new one starts at 10,000 tracks).
//   A mix can be sent to Spotify as its own private playlist.
// Sign in uses PKCE, so there is no secret anywhere. Only your Client ID (public by design) is needed.
import { state, saveSettings, saveRecord, saveMixes, emit, getMeta, setMeta } from './store.js';
import * as M from './model.js';
import { seconds } from './mixes.js';

export const SCOPES = 'playlist-modify-private playlist-read-private';
const PENDING = 'crate.spotify.pending';
export const LOVED_NAME = 'Crate loved';

const S = () => state.settings;
const authBase = () => (S().spotifyAuthBase || 'https://accounts.spotify.com').replace(/\/$/, '');
const apiBase = () => (S().spotifyApiBase || 'https://api.spotify.com').replace(/\/$/, '');
export const redirectUri = () => `${location.origin}/`;
export const connected = () => !!(S().spotify && S().spotify.refresh);
export const playlistUrl = (id) => `https://open.spotify.com/playlist/${id}`;

export class SpotifyError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const status = { busy: false, error: '' };
const note = () => emit('spotify');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- sign in

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a).slice(0, n); };
export const challengeOf = async (v) => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));

const readPending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } };
const writePending = (p) => { try { localStorage.setItem(PENDING, JSON.stringify(p)); } catch { /* private mode */ } };
const clearPending = () => { try { localStorage.removeItem(PENDING); } catch { /* fine */ } };

export async function startLogin() {
  const id = (S().spotifyClientId || '').trim();
  if (!id) throw new Error('Add your Spotify Client ID first.');
  const verifier = random(96);
  const st = random(24);
  writePending({ verifier, state: st, redirect: redirectUri(), at: Date.now() });
  const p = new URLSearchParams({
    client_id: id,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: await challengeOf(verifier),
    state: st,
  });
  location.href = `${authBase()}/authorize?${p}`;
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(`${authBase()}/api/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  } catch {
    throw new SpotifyError(0, 'Could not reach Spotify. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SpotifyError(res.status, data.error_description || data.error || 'Spotify sign in failed.');
  return data;
}

async function keepTokens(d) {
  const old = S().spotify || {};
  await saveSettings({ spotify: { ...old, access: d.access_token, refresh: d.refresh_token || old.refresh, expires: Date.now() + Math.max(30, (d.expires_in || 3600) - 30) * 1000 } });
}

export async function finishLogin(code, verifier, redirect) {
  const d = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: S().spotifyClientId, code_verifier: verifier });
  await keepTokens(d);
  const me = await call('/v1/me');
  await saveSettings({ spotify: { ...S().spotify, userId: me.id, name: me.display_name || me.id } });
  status.error = '';
  note();
}

// Called once at start. Spotify sends you back to the app with ?code=...
export async function handleReturn() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return { kind: 'none' };
  const code = q.get('code');
  const st = q.get('state');
  const err = q.get('error');
  const clean = () => history.replaceState(null, '', location.pathname + (location.hash || ''));
  const pending = readPending();
  if (err) {
    clean();
    clearPending();
    return { kind: 'error', message: err === 'access_denied' ? 'You chose not to allow Spotify.' : `Spotify said: ${err}` };
  }
  // On iPhone the return can open in a different window to the one that started it. That window has no
  // sign in to finish, so it shows the code to copy across.
  if (!pending || pending.state !== st) return { kind: 'copy', code };
  try {
    await finishLogin(code, pending.verifier, pending.redirect);
    clearPending();
    clean();
    return { kind: 'done' };
  } catch (e) {
    clean();
    clearPending();
    return { kind: 'error', message: e.message };
  }
}

// The same thing, with the code pasted in by hand.
export async function finishWithCode(code) {
  const pending = readPending();
  if (!pending) throw new Error('Press Connect Spotify first, then paste the code.');
  await finishLogin(String(code).trim(), pending.verifier, pending.redirect);
  clearPending();
}

export async function disconnect() {
  await saveSettings({ spotify: null, spotifyQueue: [] });
  status.error = '';
  note();
}

async function refresh() {
  const s = S().spotify;
  try {
    const d = await tokenRequest({ grant_type: 'refresh_token', refresh_token: s.refresh, client_id: S().spotifyClientId });
    await keepTokens(d);
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      await saveSettings({ spotify: null });
      status.error = 'Spotify needs you to connect again.';
      note();
      throw new SpotifyError(401, status.error);
    }
    throw e;
  }
}

// ---------------------------------------------------------------- calls

async function call(path, { method = 'GET', body, query, again = true, tries = 0 } = {}) {
  const s = S().spotify;
  if (!s || !s.access) throw new SpotifyError(401, 'Not connected to Spotify.');
  if (Date.now() > s.expires) await refresh();
  const url = new URL(apiBase() + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${S().spotify.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SpotifyError(0, 'Could not reach Spotify. Check your connection.');
  }
  if (res.status === 401 && again) {
    await refresh();
    return call(path, { method, body, query, again: false, tries });
  }
  if (res.status === 429 && tries < 3) {
    await sleep((Number(res.headers.get('Retry-After')) || 3) * 1000);
    return call(path, { method, body, query, again, tries: tries + 1 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SpotifyError(res.status, (data.error && (data.error.message || data.error)) || 'Spotify said no.');
  return data;
}

// ---------------------------------------------------------------- matching

const VERSIONS = ['live', 'instrumental', 'remix', 'acoustic', 'demo', 'karaoke'];
const words = (s) => M.norm(s).replace(/[^a-z0-9 ]/g, ' ');
const versionsOf = (s) => VERSIONS.filter((v) => words(s).split(/\s+/).includes(v)).join(',');
const strip = (s) => M.norm(s)
  .replace(/\(.*?\)|\[.*?\]/g, ' ')
  .replace(/\s[-–]\s.*$/, ' ')
  .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

// How well does one Spotify result fit the track we want? 4 or more is a match.
export function scoreCandidate(c, want) {
  const t1 = strip(c.name);
  const t2 = strip(want.title);
  if (!t2 || !t1) return -99;
  let score = 0;
  if (t1 === t2) score += 3;
  else if (t1.includes(t2) || t2.includes(t1)) score += 1;
  else return -99;
  const a2 = strip(want.artist);
  const artists = (c.artists || []).map((x) => strip(x.name));
  if (!a2 || /^various/.test(a2)) score += 1;
  else if (artists.some((a) => a === a2 || a.includes(a2) || a2.includes(a))) score += 2;
  else score -= 4;
  if (want.seconds && c.duration_ms) {
    const d = Math.abs(c.duration_ms / 1000 - want.seconds);
    if (d <= 4) score += 1;
    else if (d > 90) score -= 2; // very different, probably another version
    else if (d > 25) score -= 1; // Discogs times often belong to the pressing, not the album track
  }
  const al = strip(c.album && c.album.name);
  const wa = strip(want.album);
  if (al && wa && (al === wa || al.includes(wa) || wa.includes(al))) score += 1;
  if (versionsOf(c.name + ' ' + ((c.album && c.album.name) || '')) !== versionsOf(want.title)) score -= 5;
  return score;
}

export function pick(cands, want) {
  let best = null;
  let top = 3;
  for (const c of cands) {
    const sc = scoreCandidate(c, want);
    if (sc > top) { top = sc; best = c; }
  }
  return best;
}

const found = (c) => ({ uri: c.uri, name: c.name, artist: (c.artists || []).map((a) => a.name).join(', ') });

export async function matchTrack(want) {
  const t = String(want.title).replace(/"/g, '');
  const a = String(want.artist || '').replace(/"/g, '');
  const various = !a || /^various/i.test(a);
  const tries = [`track:"${t}"${various ? '' : ` artist:"${a}"`}`, `${various ? '' : a + ' '}${t}`];
  for (const q of tries) {
    const res = await call('/v1/search', { query: { q, type: 'track', limit: 5 } });
    const best = pick((res.tracks && res.tracks.items) || [], want);
    if (best) return found(best);
  }
  return null;
}

// ---------------------------------------------------------------- playlists

export const ALL_NAME = 'Crate collection';
const LIMIT = () => S().spotifyAllLimit || 10000; // a Spotify playlist holds 10,000 tracks

async function createPlaylist(name, description) {
  const body = { name, description, public: false };
  try {
    return (await call('/v1/me/playlists', { method: 'POST', body })).id;
  } catch (e) {
    if (e.status !== 404 && e.status !== 405) throw e;
    return (await call(`/v1/users/${encodeURIComponent(S().spotify.userId)}/playlists`, { method: 'POST', body })).id;
  }
}

// Spotify has been renaming this endpoint, so try the new name first, then the old one.
async function addUris(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    const body = { uris: uris.slice(i, i + 100) };
    try {
      await call(`/v1/playlists/${playlistId}/items`, { method: 'POST', body });
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      await call(`/v1/playlists/${playlistId}/tracks`, { method: 'POST', body });
    }
  }
}

// Another phone or computer may already have made this playlist. Look for it by name first.
async function findPlaylist(name) {
  try {
    for (let offset = 0; offset < 400; offset += 50) {
      const res = await call('/v1/me/playlists', { query: { limit: 50, offset } });
      const items = res.items || [];
      const hit = items.find((p) => p && p.name === name && p.owner && p.owner.id === S().spotify.userId);
      if (hit) return { id: hit.id, total: (hit.tracks && hit.tracks.total) ?? (hit.items && hit.items.total) ?? 0 };
      if (items.length < 50) break;
    }
  } catch (e) {
    if (e.status === 0) throw e; // no permission to look, so just make a new one
  }
  return null;
}

async function namedPlaylist(name, description) {
  return (await findPlaylist(name)) || { id: await createPlaylist(name, description), total: 0 };
}

async function lovedPlaylist() {
  const ids = S().spotifyPlaylists || {};
  if (ids.loved) return ids.loved;
  const { id } = await namedPlaylist(LOVED_NAME, 'Tracks I love from my record collection. Made by Crate.');
  await saveSettings({ spotifyPlaylists: { ...(S().spotifyPlaylists || {}), loved: id } });
  return id;
}

// When "Crate collection" fills up, the next one is called "Crate collection 2", and so on.
async function addToCollection(uris) {
  const plays = { ...(S().spotifyPlaylists || {}) };
  const all = [...(plays.all || [])];
  let rest = uris.slice();
  for (let guard = 0; rest.length && guard < 50; guard++) {
    let cur = all[all.length - 1];
    if (!cur || cur.n >= LIMIT()) {
      const name = all.length ? `${ALL_NAME} ${all.length + 1}` : ALL_NAME;
      const f = await namedPlaylist(name, 'Every track from my record collection. Made by Crate.');
      cur = { id: f.id, n: f.total };
      all.push(cur);
      if (cur.n >= LIMIT()) continue;
    }
    const chunk = rest.slice(0, LIMIT() - cur.n);
    await addUris(cur.id, chunk);
    cur.n += chunk.length;
    rest = rest.slice(chunk.length);
  }
  await saveSettings({ spotifyPlaylists: { ...plays, all } });
}

// Tracks already in the collection playlists, so the same song on two records is added once.
let uriSet = null;
let dirty = 0;
const known = async () => { if (!uriSet) uriSet = new Set((await getMeta('spAllUris')) || []); return uriSet; };
const keepKnown = async (force) => { if (uriSet && (force || dirty >= 40)) { await setMeta('spAllUris', [...uriSet]); dirty = 0; } };

// ---------------------------------------------------------------- the queue
// Jobs are kept in the settings, so closing the app does not lose them.
//   love: add one hearted track to "Crate loved"
//   rec:  add every track of one record to "Crate collection"

const queue = () => S().spotifyQueue || [];
const kindOf = (j) => j.kind || 'love';

async function push(job) {
  const q = queue();
  if (q.some((j) => kindOf(j) === job.kind && j.recId === job.recId && j.key === job.key)) return false;
  await saveSettings({ spotifyQueue: [...q, job] });
  return true;
}

const trackOf = (rec, key) => (rec.tracklist || []).find((t) => M.trackKey(t) === key) || (() => {
  const [position, ...rest] = key.split('|');
  return { position, title: rest.join('|'), duration: '' };
})();

export function loveStatus(rec, track) {
  const e = rec.spotify && rec.spotify[M.trackKey(track)];
  if (!e) return '';
  return e.added ? 'added' : e.miss ? 'miss' : '';
}

export const lovedPending = () => queue().length;
export const recsPending = () => queue().filter((j) => kindOf(j) === 'rec').length;

export async function enqueueLove(rec, track) {
  if (!connected() || S().spotifyAuto === false) return;
  const key = M.trackKey(track);
  const e = rec.spotify && rec.spotify[key];
  if (e && e.added) return;
  if (await push({ kind: 'love', recId: rec.id, key })) { note(); kickLoved(); }
}

export async function enqueueAllLoved() {
  let n = 0;
  for (const rec of state.records.values()) {
    for (const key of rec.loved || []) {
      const e = rec.spotify && rec.spotify[key];
      if (e && e.added) continue;
      if (await push({ kind: 'love', recId: rec.id, key })) n++;
    }
  }
  note();
  kickLoved();
  return n;
}

// A new record: add all its tracks.
export async function enqueueRecord(rec) {
  if (rec.wanted) return; // a record you only want does not go on your Spotify playlists
  if (!connected() || S().spotifyAll === false || rec.spAllDone) return;
  if (await push({ kind: 'rec', recId: rec.id })) { note(); kickLoved(); }
}

// Everything you already own. Records with no tracklist yet are fetched from Discogs as it goes.
export async function enqueueWholeCollection() {
  let n = 0;
  for (const rec of state.records.values()) {
    if (rec.spAllDone || rec.status === 'sold' || rec.wanted) continue;
    if (!(rec.tracklist && rec.tracklist.length) && !(rec.source === 'discogs' && rec.releaseId)) continue;
    if (await push({ kind: 'rec', recId: rec.id })) n++;
  }
  note();
  kickLoved();
  return n;
}

let running = false;
export const missed = []; // titles Spotify did not have, shown once by the screen that cares

export async function kickLoved() {
  if (running || !connected()) return;
  running = true;
  status.busy = true;
  note();
  try {
    while (connected() && queue().length) {
      if (navigator.onLine === false) break;
      const job = queue()[0];
      let skipped = '';
      try {
        if (kindOf(job) === 'rec') await doRecord(job);
        else await doLove(job);
      } catch (e) {
        // A problem with this one track or playlist is skipped. Anything else stops the queue.
        if (![400, 404, 422].includes(e.status)) throw e;
        skipped = e.message;
      }
      await saveSettings({ spotifyQueue: queue().slice(1) });
      status.error = skipped;
      await keepKnown(false);
      note();
    }
  } catch (e) {
    status.error = e.message;
    if (e.status === 0) setTimeout(kickLoved, 30000);
  } finally {
    await keepKnown(true).catch(() => {});
    running = false;
    status.busy = false;
    note();
  }
}

async function doLove(job) {
  const rec = state.records.get(job.recId);
  if (!rec || !(rec.loved || []).includes(job.key)) return;
  const track = trackOf(rec, job.key);
  rec.spotify = rec.spotify || {};
  let e = rec.spotify[job.key];
  try {
    if (!e || (!e.uri && !e.miss)) {
      const m = await matchTrack({ title: track.title, artist: rec.artist, album: rec.title, seconds: seconds(track.duration) });
      e = m ? { uri: m.uri, name: m.name } : { miss: true };
      rec.spotify[job.key] = e;
      if (!m) missed.push(track.title);
    }
    if (e.uri && !e.added) {
      await addToLoved(e.uri);
      e.added = true;
    }
  } finally {
    await saveRecord(rec, { quiet: true });
  }
}

async function addToLoved(uri) {
  try {
    await addUris(await lovedPlaylist(), [uri]);
  } catch (e) {
    if (e.status !== 404) throw e;
    // Someone deleted the playlist in Spotify. Make a new one.
    await saveSettings({ spotifyPlaylists: { ...(S().spotifyPlaylists || {}), loved: '' } });
    await addUris(await lovedPlaylist(), [uri]);
  }
}

async function doRecord(job) {
  const rec = state.records.get(job.recId);
  if (!rec || rec.spAllDone) return;
  if (!(rec.tracklist && rec.tracklist.length) && rec.source === 'discogs' && rec.releaseId) {
    const { ensureDetail } = await import('./sync.js');
    try { await ensureDetail(rec); } catch (e) { if (e.status === 0 || e.status === 401) throw e; }
  }
  const tracks = (rec.tracklist || []).filter((t) => !t.heading && t.title);
  const have = await known();
  rec.spotify = rec.spotify || {};
  const fresh = [];
  try {
    for (const t of tracks) {
      const key = M.trackKey(t);
      let e = rec.spotify[key];
      if (!e || (!e.uri && !e.miss)) {
        const m = await matchTrack({ title: t.title, artist: rec.artist, album: rec.title, seconds: seconds(t.duration) });
        e = m ? { uri: m.uri, name: m.name } : { miss: true };
        rec.spotify[key] = e;
        await sleep(120); // be gentle with Spotify
      }
      if (e.uri && !e.all) {
        if (have.has(e.uri)) e.all = true;
        else fresh.push(e);
      }
    }
    const uris = [...new Set(fresh.map((e) => e.uri))];
    if (uris.length) {
      await addToCollection(uris);
      uris.forEach((u) => have.add(u));
      dirty += uris.length;
      fresh.forEach((e) => { e.all = true; });
    }
    rec.spAllDone = true;
  } finally {
    await saveRecord(rec, { quiet: true });
  }
}

// ---------------------------------------------------------------- mixes

// Match every track in the mix, then add the new ones to its playlist.
export async function sendMix(mix, onProgress) {
  const total = mix.tracks.length;
  let done = 0;
  try {
    for (const t of mix.tracks) {
      if (!t.spotify) {
        const m = await matchTrack({ title: t.title, artist: t.artist, album: t.album, seconds: seconds(t.duration) });
        t.spotify = m ? { uri: m.uri, name: m.name } : null;
      }
      onProgress(++done, total);
    }
    const fresh = mix.tracks.filter((t) => t.spotify && t.spotify.uri && !t.spotify.added);
    if (fresh.length) {
      if (!mix.spotifyId) mix.spotifyId = await createPlaylist(mix.name, 'Made by Crate.');
      try {
        await addUris(mix.spotifyId, fresh.map((t) => t.spotify.uri));
      } catch (e) {
        if (e.status !== 404) throw e;
        mix.spotifyId = await createPlaylist(mix.name, 'Made by Crate.');
        await addUris(mix.spotifyId, fresh.map((t) => t.spotify.uri));
      }
      fresh.forEach((t) => { t.spotify.added = true; });
    }
    return {
      added: fresh.length,
      missing: mix.tracks.filter((t) => t.spotify === null).map((t) => `${t.artist}, ${t.title}`),
      playlistId: mix.spotifyId || '',
    };
  } finally {
    await saveMixes();
  }
}
