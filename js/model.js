// Record shape, grades, value maths, filters. No network and no screen code here.
import { newId } from './store.js';

export const GRADES = [
  { code: 'M',  name: 'Mint (M)',             blurb: 'Perfect. Never played, often still sealed.' },
  { code: 'NM', name: 'Near Mint (NM or M-)', blurb: 'Almost perfect. Looks and sounds like new.' },
  { code: 'VG+', name: 'Very Good Plus (VG+)', blurb: 'Light signs of use. Plays with little or no noise.' },
  { code: 'VG', name: 'Very Good (VG)',       blurb: 'Clear wear and some surface noise. Still plays well.' },
  { code: 'G+', name: 'Good Plus (G+)',       blurb: 'Heavy wear and noise, but it plays through.' },
  { code: 'G',  name: 'Good (G)',             blurb: 'Very worn. Plays through with a lot of noise.' },
  { code: 'F',  name: 'Fair (F)',             blurb: 'Badly worn. May skip or jump.' },
  { code: 'P',  name: 'Poor (P)',             blurb: 'Barely playable.' },
];

export const SLEEVE_EXTRAS = [
  { code: 'Generic', name: 'Generic' },
  { code: 'Not Graded', name: 'Not Graded' },
  { code: 'No Cover', name: 'No Cover' },
];

export const STATUS = { keeping: 'Keeping', for_sale: 'For sale', sold: 'Sold' };

export function gradeName(code) {
  const g = GRADES.find((x) => x.code === code) || SLEEVE_EXTRAS.find((x) => x.code === code);
  return g ? g.name : '';
}

export function gradeCode(name) {
  if (!name) return '';
  const n = String(name).trim().toLowerCase();
  const hit = GRADES.find((g) => g.name.toLowerCase() === n || g.code.toLowerCase() === n);
  if (hit) return hit.code;
  const extra = SLEEVE_EXTRAS.find((g) => g.name.toLowerCase() === n);
  if (extra) return extra.code;
  const m = n.match(/\(([^)]+)\)/);
  if (m) {
    const c = m[1].split(' ')[0].toUpperCase();
    const h = GRADES.find((g) => g.code === c);
    if (h) return h.code;
  }
  return '';
}

// ---------- names and formats ----------

export const cleanName = (s) => String(s || '').replace(/\s*\(\d+\)$/, '').trim();

export function artistString(artists) {
  if (!artists || !artists.length) return '';
  let out = '';
  artists.forEach((a, i) => {
    out += cleanName(a.anv || a.name);
    const j = (a.join || '').trim();
    if (i < artists.length - 1) out += j ? (j === ',' ? ', ' : ` ${j} `) : ', ';
  });
  return out.trim();
}

export function splitTitle(t) {
  const s = String(t || '');
  const i = s.indexOf(' - ');
  if (i < 0) return { artist: '', title: s };
  return { artist: cleanName(s.slice(0, i)), title: s.slice(i + 3) };
}

export function formatInfo(formats) {
  const tags = [];
  const parts = [];
  for (const f of formats || []) {
    tags.push(f.name);
    (f.descriptions || []).forEach((d) => tags.push(d));
    const qty = Number(f.qty) > 1 ? `${f.qty} x ` : '';
    parts.push([qty + f.name, ...(f.descriptions || []), f.text].filter(Boolean).join(', '));
  }
  return { tags: [...new Set(tags.filter(Boolean))], text: parts.join(' + ') };
}

export function formatShort(r) {
  const t = (r.formatTags || []).filter((x) => x !== 'Vinyl' && x !== 'All Media');
  return t.slice(0, 3).join(', ') || (r.formatTags || [])[0] || '';
}

export function isVinyl(r) {
  return (r.formatTags || []).includes('Vinyl');
}

// ---------- building records ----------

export function newRecord(shell, extra = {}) {
  return {
    status: 'keeping',
    mediaGrade: '',
    sleeveGrade: '',
    notes: '',
    keepForever: false,
    instanceId: null,
    detail: false,
    wantDetail: false,
    fieldsDirty: false,
    market: null,
    ...shell,
    ...extra,
    id: newId(),
    added: extra.added || Date.now(),
  };
}

// From a Discogs search result. This is a "shell": enough to show and save.
export function fromSearch(r) {
  const { artist, title } = splitTitle(r.title);
  let fi;
  if (r.formats && r.formats.length) fi = formatInfo(r.formats);
  else fi = { tags: (r.format || []).slice(), text: (r.format || []).join(', ') };
  return {
    source: 'discogs',
    releaseId: r.id,
    masterId: r.master_id || null,
    artist,
    title,
    label: (r.label || [])[0] || '',
    catno: r.catno || '',
    year: r.year ? Number(r.year) : null,
    country: r.country || '',
    formatTags: fi.tags,
    formatText: fi.text,
    genres: r.genre || [],
    styles: r.style || [],
    barcode: '',
    thumb: r.thumb || '',
    cover: r.cover_image || r.thumb || '',
  };
}

// From the "other pressings" list of a master release.
export function fromVersion(v, base) {
  const tags = ['Vinyl'].concat(String(v.format || '').split(',').map((s) => s.trim()).filter(Boolean));
  return {
    ...base,
    releaseId: v.id,
    label: v.label || base.label,
    catno: v.catno || '',
    year: v.released ? Number(String(v.released).slice(0, 4)) || base.year : base.year,
    country: v.country || '',
    formatTags: [...new Set(v.major_formats && v.major_formats.length ? v.major_formats.concat(tags) : tags)],
    formatText: v.format || base.formatText,
    thumb: v.thumb || base.thumb,
    cover: v.thumb || base.cover,
    images: undefined,
    tracklist: undefined,
    detail: false,
  };
}

export function youtubeId(uri) {
  try {
    const u = new URL(uri);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).slice(0, 20);
    return u.searchParams.get('v') || '';
  } catch {
    return '';
  }
}

// A track is identified by its position and title, so hearts survive a re-fetch of the tracklist.
export const trackKey = (t) => `${t.position || ''}|${t.title || ''}`;
export const isLoved = (rec, t) => (rec.loved || []).includes(trackKey(t));

export function clock(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return '';
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Fill a record from the full Discogs release page.
export function applyRelease(rec, rel, currency) {
  rec.artist = artistString(rel.artists) || rec.artist;
  rec.title = rel.title || rec.title;
  rec.year = rel.year || rec.year;
  rec.country = rel.country || rec.country;
  rec.released = rel.released_formatted || rel.released || '';
  if (rel.labels && rel.labels.length) {
    rec.label = rel.labels[0].name;
    rec.catno = rel.labels[0].catno || rec.catno;
    rec.labels = rel.labels.map((l) => ({ name: l.name, catno: l.catno }));
  }
  rec.genres = rel.genres || rec.genres || [];
  rec.styles = rel.styles || rec.styles || [];
  if (rel.formats && rel.formats.length) {
    const fi = formatInfo(rel.formats);
    rec.formatTags = fi.tags;
    rec.formatText = fi.text;
  }
  rec.tracklist = (rel.tracklist || [])
    .filter((t) => t.type_ === 'track' || t.type_ === 'heading' || t.type_ === 'index')
    .map((t) => ({ position: t.position || '', title: t.title || '', duration: t.duration || '', heading: t.type_ === 'heading' }));
  rec.images = (rel.images || []).slice(0, 8).map((i) => ({ uri: i.uri || i.resource_url, thumb: i.uri150 || i.uri, type: i.type }));
  if (rec.images[0]) {
    rec.cover = rec.images[0].uri;
    rec.thumb = rec.images[0].thumb || rec.thumb;
  } else if (rel.thumb) {
    rec.thumb = rel.thumb;
  }
  rec.identifiers = (rel.identifiers || []).map((i) => ({ type: i.type, value: i.value, description: i.description || '' }));
  if (!rec.barcode) {
    const b = rec.identifiers.find((i) => i.type === 'Barcode');
    if (b) rec.barcode = String(b.value).replace(/\D/g, '');
  }
  rec.videos = (rel.videos || []).map((v) => ({ id: youtubeId(v.uri), title: v.title || '', duration: v.duration || 0 })).filter((v) => v.id).slice(0, 12);
  rec.releaseNotes = (rel.notes || '').slice(0, 2500);
  rec.community = rel.community ? { have: rel.community.have, want: rel.community.want } : rec.community || null;
  rec.masterId = rel.master_id || rec.masterId || null;
  rec.market = rec.market || {};
  if (typeof rel.lowest_price === 'number') {
    rec.market.lowest = rel.lowest_price;
    rec.market.numForSale = rel.num_for_sale;
    rec.market.currency = currency || rec.market.currency || 'GBP';
    rec.market.updated = rec.market.updated || 0;
  }
  rec.detail = true;
  rec.wantDetail = false;
  return rec;
}

// From one row of the user's Discogs collection.
export function fromCollectionItem(item, fieldMap) {
  const b = item.basic_information || {};
  const fi = formatInfo(b.formats);
  const rec = newRecord({
    source: 'discogs',
    releaseId: b.id,
    masterId: b.master_id || null,
    instanceId: item.instance_id,
    folderId: item.folder_id,
    artist: artistString(b.artists),
    title: b.title || '',
    label: (b.labels && b.labels[0] && b.labels[0].name) || '',
    catno: (b.labels && b.labels[0] && b.labels[0].catno) || '',
    year: b.year || null,
    formatTags: fi.tags,
    formatText: fi.text,
    genres: b.genres || [],
    styles: b.styles || [],
    thumb: b.thumb || '',
    cover: b.cover_image || b.thumb || '',
  }, { added: Date.parse(item.date_added) || Date.now() });
  for (const n of item.notes || []) {
    if (!fieldMap) break;
    if (n.field_id === fieldMap.media) rec.mediaGrade = gradeCode(n.value);
    else if (n.field_id === fieldMap.sleeve) rec.sleeveGrade = gradeCode(n.value);
    else if (n.field_id === fieldMap.notes) rec.notes = n.value || '';
  }
  return rec;
}

// ---------- value ----------

export function estimate(rec) {
  const m = rec.market;
  if (!m) return null;
  const code = rec.mediaGrade || 'VG+';
  const v = m.suggestions && m.suggestions[code];
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof m.lowest === 'number' && isFinite(m.lowest)) return m.lowest;
  return null;
}

export function money(n, cur = 'GBP', digits) {
  if (n == null || !isFinite(n)) return '';
  const d = digits != null ? digits : Math.abs(n) >= 1000 ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur, minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
  } catch {
    return `${cur} ${n.toFixed(d)}`;
  }
}

// ---------- filter and sort ----------

export const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const hayCache = new WeakMap();
function hay(r) {
  const c = hayCache.get(r);
  if (c && c.u === r.updated) return c.h;
  const h = norm([r.artist, r.title, r.label, r.catno, r.year, r.country, r.formatText,
    (r.genres || []).join(' '), (r.styles || []).join(' '), r.notes, r.barcode].join(' | '));
  hayCache.set(r, { u: r.updated, h });
  return h;
}

export const sortKey = (r) => norm(r.artist).replace(/^(the|a|an) /, '');

export function filterRecords(list, f) {
  const words = norm(f.q).split(/\s+/).filter(Boolean);
  const label = norm(f.label);
  const artist = norm(f.artist);
  const from = f.from ? Number(f.from) : 0;
  const to = f.to ? Number(f.to) : 9999;
  return list.filter((r) => {
    if (f.status && f.status !== 'all' && r.status !== f.status) return false;
    if (f.genre && !(r.genres || []).includes(f.genre)) return false;
    if (f.format && !(r.formatTags || []).includes(f.format)) return false;
    if (label && !norm(r.label).includes(label)) return false;
    if (artist && !norm(r.artist).includes(artist)) return false;
    if (from || to < 9999) {
      if (!r.year || r.year < from || r.year > to) return false;
    }
    if (words.length) {
      const h = hay(r);
      for (const w of words) if (!h.includes(w)) return false;
    }
    return true;
  });
}

export function sortRecords(list, how) {
  const out = list.slice();
  const byArtist = (a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : norm(a.title) < norm(b.title) ? -1 : 1);
  if (how === 'artist') out.sort(byArtist);
  else if (how === 'title') out.sort((a, b) => (norm(a.title) < norm(b.title) ? -1 : 1));
  else if (how === 'year') out.sort((a, b) => (a.year || 9999) - (b.year || 9999) || byArtist(a, b));
  else if (how === 'value') out.sort((a, b) => (estimate(b) || -1) - (estimate(a) || -1));
  else out.sort((a, b) => (b.added || 0) - (a.added || 0));
  return out;
}

export function facets(list) {
  const genres = new Map();
  const formats = new Map();
  for (const r of list) {
    (r.genres || []).forEach((g) => genres.set(g, (genres.get(g) || 0) + 1));
    (r.formatTags || []).forEach((g) => { if (g !== 'Vinyl' && g !== 'All Media') formats.set(g, (formats.get(g) || 0) + 1); });
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]).sort();
  return { genres: top(genres, 40), formats: top(formats, 30) };
}

export function ago(ts) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hours ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function dateStr(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const discogsUrl = (r) => (r.releaseId ? `https://www.discogs.com/release/${r.releaseId}` : '');
