// Tempo and feel for your tracks, and a way to find tracks that sit close together.
// The numbers come from ReccoBeats, a free service that returns what Spotify used to: tempo, energy,
// mood (valence), danceability and how acoustic a track is. It needs the Spotify track Crate has matched.
import { state, saveRecord } from './store.js';
import * as M from './model.js';

const BASE = () => state.settings.featuresBase || 'https://api.reccobeats.com';
const idOf = (uri) => (String(uri || '').match(/^spotify:track:([A-Za-z0-9]+)$/) || [])[1] || '';
const RETRY_AFTER = 30 * 864e5; // a track with no data is tried again after a month
const r2 = (n) => Math.round(Number(n) * 100) / 100;

export const status = { running: false, done: 0, total: 0, error: '' };

// The profile of one track, or null if it has none.
export function profileOf(rec, track) {
  const f = rec.feat && rec.feat[M.trackKey(track)];
  return f && !f.x ? f : null;
}

// A plain word for how a track feels, from how energetic and how happy it sounds.
export function moodWord(f) {
  if (!f) return '';
  const hi = f.e >= 0.62;
  const happy = f.v >= 0.5;
  if (f.a >= 0.6 && f.e < 0.5) return 'Acoustic, gentle';
  if (hi && happy) return 'Upbeat, driving';
  if (hi && !happy) return 'Dark, intense';
  if (!hi && happy) return 'Light, easy';
  return 'Moody, mellow';
}

export const describe = (f) => (f ? `${Math.round(f.t)} BPM · ${moodWord(f)}` : '');

// Every track Crate has matched on Spotify that has no profile yet.
export function waiting(onlyRec) {
  const out = [];
  const list = onlyRec ? [onlyRec] : [...state.records.values()];
  for (const rec of list) {
    if (rec.wanted) continue;
    for (const [key, e] of Object.entries(rec.spotify || {})) {
      const id = idOf(e && e.uri);
      if (!id) continue;
      const f = rec.feat && rec.feat[key];
      if (f && (!f.x || Date.now() - f.x < RETRY_AFTER)) continue;
      out.push({ rec, key, id });
    }
  }
  return out;
}

export function counts() {
  let have = 0;
  for (const rec of state.records.values()) if (!rec.wanted) for (const f of Object.values(rec.feat || {})) if (f && !f.x) have++;
  return { have, waiting: waiting().length };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch profiles in batches. Works through everything, or just one record's tracks.
export async function fetchProfiles({ rec = null, onProgress } = {}) {
  if (status.running) return;
  const todo = waiting(rec);
  status.running = true; status.done = 0; status.total = todo.length; status.error = '';
  try {
    for (let i = 0; i < todo.length; i += 30) {
      const batch = todo.slice(i, i + 30);
      const ids = [...new Set(batch.map((b) => b.id))];
      let res = null;
      for (let tries = 0; tries < 3 && !res; tries++) {
        const r = await fetch(`${BASE()}/v1/audio-features?ids=${ids.join(',')}`);
        if (r.status === 429) { await sleep(4000 * (tries + 1)); continue; }
        if (!r.ok) throw new Error(`The tempo service answered ${r.status}.`);
        res = await r.json();
      }
      if (!res) throw new Error('The tempo service is busy. Try again in a minute.');
      const byId = new Map();
      for (const it of res.content || []) {
        const id = String(it.href || '').split('/').pop();
        if (id) byId.set(id, it);
      }
      const touched = new Set();
      for (const b of batch) {
        const f = byId.get(b.id);
        b.rec.feat = b.rec.feat || {};
        b.rec.feat[b.key] = f && Number(f.tempo) > 0
          ? { t: r2(f.tempo), e: r2(f.energy), v: r2(f.valence), d: r2(f.danceability), a: r2(f.acousticness), i: r2(f.instrumentalness) }
          : { x: Date.now() };
        touched.add(b.rec);
      }
      for (const r of touched) await saveRecord(r, { quiet: true });
      status.done = Math.min(todo.length, i + batch.length);
      if (onProgress) onProgress({ ...status });
      if (i + 30 < todo.length) await sleep(350);
    }
  } catch (e) {
    status.error = e && e.message ? e.message : 'Could not reach the tempo service.';
  } finally {
    status.running = false;
    if (onProgress) onProgress({ ...status });
  }
}

// Tracks from your collection that sit close to this one. Closest first.
export function similar(rec, track, { decade = true, style = true, bpm = 8, limit = 40 } = {}) {
  const f = profileOf(rec, track);
  if (!f) return null;
  const key = M.trackKey(track);
  const dec = rec.year ? Math.floor(rec.year / 10) : null;
  const myStyles = rec.styles || [];
  const myGenres = rec.genres || [];
  const out = [];
  for (const r of state.records.values()) {
    if (r.wanted || !r.feat) continue;
    if (decade && dec != null && !(r.year && Math.floor(r.year / 10) === dec)) continue;
    if (style) {
      const near = myStyles.length ? (r.styles || []).some((s) => myStyles.includes(s)) : (r.genres || []).some((g) => myGenres.includes(g));
      if (!near) continue;
    }
    for (const t of r.tracklist || []) {
      if (t.heading) continue;
      const k = M.trackKey(t);
      if (r.id === rec.id && k === key) continue;
      const g = r.feat[k];
      if (!g || g.x) continue;
      // A record at double or half the speed still mixes, so those count as close.
      const d = Math.min(Math.abs(g.t - f.t), Math.abs(g.t * 2 - f.t), Math.abs(g.t / 2 - f.t));
      if (bpm && d > bpm) continue;
      const dist = Math.sqrt((d / 20) ** 2 + (g.e - f.e) ** 2 + (g.v - f.v) ** 2 + (g.d - f.d) ** 2);
      out.push({ rec: r, track: t, f: g, d, dist });
    }
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
}
