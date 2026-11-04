// Mix lists: a named, ordered list of tracks picked from your records.
// Each track keeps its own copy of the artist, title and album, so a mix
// survives even if you later delete the record.
import { state, saveMixes, newId } from './store.js';

export const getMix = (id) => state.mixes.find((m) => m.id === id);

export function seconds(d) {
  const parts = String(d || '').split(':').map(Number);
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((t, n) => t * 60 + n, 0);
}

export function span(sec) {
  if (!sec) return '';
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const mixSeconds = (m) => m.tracks.reduce((t, x) => t + seconds(x.duration), 0);

export async function createMix(name) {
  const m = { id: newId(), name: String(name || '').trim() || 'New mix', created: Date.now(), updated: Date.now(), tracks: [] };
  state.mixes.unshift(m);
  await saveMixes();
  return m;
}

export async function renameMix(id, name) {
  const m = getMix(id);
  if (!m) return;
  m.name = String(name || '').trim() || m.name;
  m.updated = Date.now();
  await saveMixes();
}

export async function deleteMix(id) {
  state.mixes = state.mixes.filter((m) => m.id !== id);
  await saveMixes();
}

export function inMix(m, rec, t) {
  return m.tracks.some((x) => x.recordId === rec.id && x.position === t.position && x.title === t.title);
}

// Returns false if the track was already in the mix.
export async function addTrack(mixId, rec, t) {
  const m = getMix(mixId);
  if (!m || inMix(m, rec, t)) return false;
  m.tracks.push({
    id: newId(),
    recordId: rec.id,
    releaseId: rec.releaseId || null,
    position: t.position || '',
    title: t.title,
    artist: rec.artist,
    album: rec.title,
    duration: t.duration || '',
    thumb: rec.thumb || '',
    cover: rec.cover || '',
  });
  m.updated = Date.now();
  await saveMixes();
  return true;
}

export async function removeTrack(mixId, trackId) {
  const m = getMix(mixId);
  if (!m) return;
  m.tracks = m.tracks.filter((t) => t.id !== trackId);
  m.updated = Date.now();
  await saveMixes();
}

export async function moveTrack(mixId, trackId, dir) {
  const m = getMix(mixId);
  if (!m) return;
  const i = m.tracks.findIndex((t) => t.id === trackId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= m.tracks.length) return;
  [m.tracks[i], m.tracks[j]] = [m.tracks[j], m.tracks[i]];
  m.updated = Date.now();
  await saveMixes();
}

// Plain text you can paste anywhere.
export function mixText(m) {
  const lines = m.tracks.map((t, i) => `${i + 1}. ${t.artist} - ${t.title}${t.album ? ` (${t.album})` : ''}${t.duration ? ` ${t.duration}` : ''}`);
  return `${m.name}\n\n${lines.join('\n')}\n`;
}
