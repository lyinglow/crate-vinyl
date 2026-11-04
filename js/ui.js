// Small helpers for building screens: escaping, sheets, toasts, covers, photos.
import { photoUrl } from './store.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- icons (simple outlines) ----------
const P = {
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: '<path d="M8 6.5h12M8 12h12M8 17.5h12"/><circle cx="4.2" cy="6.5" r=".6"/><circle cx="4.2" cy="12" r=".6"/><circle cx="4.2" cy="17.5" r=".6"/>',
  scan: '<path d="M4 8V6.5A2.5 2.5 0 0 1 6.5 4H8M16 4h1.5A2.5 2.5 0 0 1 20 6.5V8M20 16v1.5a2.5 2.5 0 0 1-2.5 2.5H16M8 20H6.5A2.5 2.5 0 0 1 4 17.5V16"/><path d="M8 9v6M11 9v6M14 9v6M16.5 9v6"/>',
  tag: '<path d="M3.5 12.2V5.5a2 2 0 0 1 2-2h6.7a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.7 6.7a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.6-1.4Z"/><circle cx="8.2" cy="8.2" r="1.2"/>',
  value: '<path d="M4 19.5h16"/><path d="M6 16v-4M11 16V8M16 16v-6"/><path d="M5 9l5-4 4 3 5-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  camera: '<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2a1 1 0 0 0 .9-.6l.5-1A1 1 0 0 1 10 4h4a1 1 0 0 1 .9.4l.5 1a1 1 0 0 0 .9.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5Z"/><circle cx="12" cy="12.5" r="3.2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
};
export function icon(name, size = 24) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- covers ----------
function hue(rec) {
  const s = `${rec.artist}|${rec.title}`;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

// Sleeve picture. A tinted tile with the name sits underneath, so there is never a blank square.
export function cover(rec, { small = false, badge = '' } = {}) {
  const src = small ? rec.thumb || rec.cover : rec.cover || rec.thumb;
  const alt = small ? rec.cover : rec.thumb;
  const ph = `<span class="ph"><b>${esc(rec.artist)}</b>${esc(rec.title)}</span>`;
  let img = '';
  if (src) {
    img = `<img src="${esc(src)}" data-alt="${alt && alt !== src ? esc(alt) : ''}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  } else if (rec.photoSleeve) {
    img = `<img data-photo="${esc(rec.photoSleeve)}" alt="">`;
  }
  const b = badge ? `<i class="badge ${badge === 'Sold' ? 'sold' : 'sale'}">${esc(badge)}</i>` : '';
  const dim = rec.status === 'sold' ? ' dim' : '';
  return `<div class="cover${dim}" style="--h:${hue(rec)}">${ph}${img}${b}</div>`;
}

// If a picture fails to load, try the smaller one, then give up and show the tile.
document.addEventListener('error', (e) => {
  const t = e.target;
  if (!t || t.tagName !== 'IMG') return;
  if (t.dataset.alt) {
    const a = t.dataset.alt;
    t.dataset.alt = '';
    t.src = a;
  } else if (t.closest('.cover')) {
    t.remove();
  }
}, true);

export async function hydratePhotos(root) {
  for (const img of $$('img[data-photo]', root)) {
    const url = await photoUrl(img.dataset.photo);
    if (url) img.src = url;
  }
}

// Shrink a photo before saving, so 2,000 records stay small.
export async function shrinkPhoto(file, max = 1000, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not open that photo.'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Opens the camera or photo picker. Resolves with a shrunk Blob, or null if cancelled.
export function pickPhoto({ camera = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (camera) input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (v) => { if (!done) { done = true; input.remove(); resolve(v); } };
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      if (!f) return finish(null);
      try { finish(await shrinkPhoto(f)); } catch { finish(null); }
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

// ---------- sheets ----------
export function openSheet({ title = '', body = '', className = '', onClose } = {}) {
  const layer = document.getElementById('layer');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="backdrop"></div><section class="sheet ${className}" role="dialog" aria-modal="true"><div class="grab"></div>${title ? `<h2 class="sheet-title">${esc(title)}</h2>` : ''}<div class="sheet-body">${body}</div></section>`;
  layer.appendChild(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('in')));
  let closed = false;
  const api = {
    root: wrap,
    el: wrap.querySelector('.sheet-body'),
    sheet: wrap.querySelector('.sheet'),
    close() {
      if (closed) return;
      closed = true;
      wrap.classList.remove('in');
      setTimeout(() => wrap.remove(), 260);
      if (onClose) onClose();
    },
  };
  wrap.querySelector('.backdrop').addEventListener('click', () => api.close());
  return api;
}

export function confirmSheet({ title = '', text = '', yes = 'OK', no = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const s = openSheet({
      title,
      body: `<p class="muted pre">${esc(text)}</p><div class="stack"><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button><button class="btn ghost" data-no>${esc(no)}</button></div>`,
      onClose: () => resolve(answer),
    });
    s.el.querySelector('[data-yes]').onclick = () => { answer = true; s.close(); };
    s.el.querySelector('[data-no]').onclick = () => s.close();
  });
}

let toastTimer = null;
export function toast(msg, { action = '', onAction = null, ms = 4500 } = {}) {
  const layer = document.getElementById('layer');
  layer.querySelectorAll('.toast').forEach((t) => t.remove());
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  layer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  const gone = () => { t.classList.remove('in'); setTimeout(() => t.remove(), 250); };
  if (action) t.querySelector('button').onclick = () => { gone(); if (onAction) onAction(); };
  toastTimer = setTimeout(gone, ms);
}

// Pills that behave like a radio group. Returns a getter.
export function bindChips(container, onPick) {
  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-code]');
    if (!b || !container.contains(b)) return;
    const was = b.classList.contains('on');
    container.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    if (!was || !container.hasAttribute('data-toggle')) b.classList.add('on');
    onPick(b.classList.contains('on') ? b.dataset.code : '');
  });
}

export function chipRow(codes, current, { attr = '' } = {}) {
  return `<div class="chips grades" ${attr}>${codes.map((c) => `<button type="button" class="chip${c === current ? ' on' : ''}" data-code="${esc(c)}">${esc(c)}</button>`).join('')}</div>`;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function describeError(e) {
  if (!e) return 'Something went wrong.';
  if (e.status === 401) return 'Discogs did not accept your token. Check it in Settings.';
  return e.message || 'Something went wrong.';
}
