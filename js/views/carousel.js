// The home screen: your records as sleeves in one row you scroll sideways.
// The sleeve in the middle stands up flat and large. The ones either side tilt away.
//   Scroll sideways: browse.
//   Tap a sleeve at the side: bring it to the middle.
//   Tap the middle sleeve: turn it over to its next picture.
//   Pull the middle sleeve up: open the record.
// Only the dozen or so sleeves near the middle are drawn at any time, so 2,000 records
// stay smooth. Scrolling itself is done by the phone, which is why it feels so fluid.
import { state, subscribe } from '../store.js';
import * as M from '../model.js';
import { esc, cover, icon, hue, hydratePhotos } from '../ui.js';
import { filterState as F, filtersOn } from './library.js';
import { gallerySlides, slideUrl } from '../gallery.js';
import { openGenreSheet, genreLabel, genreOn } from './genres.js';
import { ensureDetail } from '../sync.js';

const LIVE = 6; // sleeves drawn on each side of the middle
const PULL_OPEN = 90; // pixels you must pull up to open a record
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastId = null; // the record that was in the middle when you last left
const picture = new Map(); // record id to the picture number showing in the flow

const opened = () => { try { return localStorage.getItem('crate.opened') === '1'; } catch { return false; } };
const markOpened = () => { try { localStorage.setItem('crate.opened', '1'); } catch { /* fine */ } };

export function mount(root) {
  root.innerHTML = `
    <div class="stage" id="stage">
      <div class="stage-top">
        <div><div class="stage-title">Library</div><div class="stage-sub" id="st-count"></div></div>
        <div class="stage-actions">
          <button class="pill-btn" id="genre-pill" aria-label="Filter by genre"></button>
          <a class="icon-btn" href="#/browse" aria-label="Browse as a grid. Search and filter.">${icon('grid', 22)}<i class="dot" id="st-dot" hidden></i></a>
        </div>
      </div>
      <div class="flow" id="flow" tabindex="0" aria-label="Your records. Swipe sideways to browse."></div>
      <div class="cap" id="cap" role="button" tabindex="0" aria-live="polite" aria-label="Open this record">
        <div class="cap-artist"></div><div class="cap-title"></div><div class="cap-meta"></div><div class="cap-love" id="cap-love" hidden></div>
      </div>
      <p class="cap-hint" id="hint">Pull the cover up to open it</p>
    </div>`;

  const stage = root.querySelector('#stage');
  const flow = root.querySelector('#flow');
  const cap = root.querySelector('#cap');
  const hint = root.querySelector('#hint');
  const pill = root.querySelector('#genre-pill');
  const paintPill = () => {
    pill.textContent = genreLabel();
    pill.classList.toggle('on', genreOn());
    root.querySelector('#st-dot').hidden = !filtersOn() || (genreOn() && !F.q && !F.label && !F.artist && !F.format && !F.from && !F.to && F.status === 'all');
  };
  paintPill();
  pill.onclick = () => openGenreSheet(() => { build(lastId); paintPill(); });

  let recs = [];
  let items = [];
  const live = new Map();
  let step = 100;
  let C = 260;
  let cur = -1;
  let raf = 0;
  let vtEl = null;
  let g = null;
  let flipping = false;
  let hintTimer = null;

  // ---------------------------------------------------------------- build

  const list = () => M.sortRecords(M.filterRecords([...state.records.values()], F), F.sort);

  function measure() {
    const w = flow.clientWidth || 360;
    const h = flow.clientHeight || 520;
    C = Math.round(Math.max(150, Math.min(340, w * 0.72, h * 0.52)));
    step = Math.max(40, Math.round(C * 0.34));
    flow.style.setProperty('--C', `${C}px`);
    flow.style.setProperty('--step', `${step}px`);
  }

  function build(keepId) {
    recs = list();
    live.clear();
    vtEl = null;
    cur = -1;
    if (!recs.length) {
      stage.classList.add('empty-stage');
      flow.innerHTML = '';
      cap.hidden = true;
      hint.hidden = true;
      root.querySelector('#st-count').textContent = '';
      const total = state.records.size;
      stage.insertAdjacentHTML('beforeend', `<div class="empty" id="stage-empty">
        <div class="disc"></div>
        <h2>${total ? 'Nothing matches' : 'Your library is empty'}</h2>
        <p>${total ? 'Your filters hide every record.' : 'Scan a barcode to add your first record.'}</p>
        ${total ? '<a class="btn primary" href="#/browse">Change filters</a>' : `<a class="btn primary" href="#/scan">Start scanning</a>${state.settings.token ? '<a class="btn" href="#/settings">Import my Discogs collection</a>' : ''}`}
      </div>`);
      return;
    }
    stage.classList.remove('empty-stage');
    const old = root.querySelector('#stage-empty');
    if (old) old.remove();
    cap.hidden = false;
    flow.innerHTML = '';
    const frag = document.createDocumentFragment();
    const lead = document.createElement('div');
    lead.className = 'sp';
    frag.appendChild(lead);
    items = recs.map((r, i) => {
      const d = document.createElement('div');
      d.className = 'fi';
      d.dataset.i = i;
      frag.appendChild(d);
      return d;
    });
    const tail = document.createElement('div');
    tail.className = 'sp';
    frag.appendChild(tail);
    flow.appendChild(frag);
    measure();
    let start = keepId ? recs.findIndex((r) => r.id === keepId) : -1;
    if (start < 0) start = 0;
    flow.scrollLeft = start * step;
    frame();
  }

  // ---------------------------------------------------------------- the look

  // d is how far a sleeve is from the middle, in sleeves. 0 is dead centre.
  function place(el, d) {
    const a = Math.abs(d);
    const sign = d < 0 ? -1 : 1;
    const t = Math.min(a, 1);
    const e = t * t * (3 - 2 * t); // eases in, so the middle stays flat and calm
    const far = Math.min(Math.max(a - 1, 0), 3);
    const rot = reduce() ? 0 : -sign * 58 * e;
    const scale = 1 - 0.3 * e - 0.045 * far;
    const x = sign * C * 0.3 * e;
    const z = -(e * 30 + far * 45);
    el.style.transform = `perspective(1100px) translate3d(${x.toFixed(1)}px,0,${z.toFixed(1)}px) rotateY(${rot.toFixed(1)}deg) scale(${scale.toFixed(4)})`;
    el.style.opacity = String(Math.max(0.35, 1 - 0.28 * e - 0.1 * far).toFixed(3));
    el.style.zIndex = String(200 - Math.round(a * 20));
  }

  function mountItem(i) {
    const r = recs[i];
    const fc = document.createElement('div');
    fc.className = 'fc';
    fc.innerHTML = cover(r);
    items[i].appendChild(fc);
    live.set(i, fc);
    hydratePhotos(fc);
    const k = picture.get(r.id);
    if (k) showPicture(fc, r, k);
  }

  function frame() {
    raf = 0;
    if (!recs.length) return;
    const pos = flow.scrollLeft / step;
    const lo = Math.max(0, Math.floor(pos) - LIVE);
    const hi = Math.min(recs.length - 1, Math.ceil(pos) + LIVE);
    for (const [i, el] of live) {
      if (i < lo || i > hi) { el.remove(); live.delete(i); }
    }
    for (let i = lo; i <= hi; i++) {
      if (!live.has(i)) mountItem(i);
      place(live.get(i), i - pos);
    }
    const center = Math.max(0, Math.min(recs.length - 1, Math.round(pos)));
    if (center !== cur) {
      cur = center;
      caption();
    }
    // Only the sleeve in the middle may morph into the record page.
    const mid = live.get(cur);
    if (mid && vtEl !== mid) {
      if (vtEl && vtEl.firstElementChild) vtEl.firstElementChild.style.viewTransitionName = '';
      if (mid.firstElementChild) mid.firstElementChild.style.viewTransitionName = 'cover';
      vtEl = mid;
    }
  }

  function caption() {
    const r = recs[cur];
    if (!r) return;
    lastId = r.id;
    const badge = r.status === 'for_sale' ? 'For sale' : r.status === 'sold' ? 'Sold' : '';
    cap.querySelector('.cap-artist').textContent = r.artist || 'Unknown artist';
    cap.querySelector('.cap-title').textContent = r.title;
    cap.querySelector('.cap-meta').textContent = [r.year, r.label, M.formatShort(r), badge].filter(Boolean).join(' · ');
    root.querySelector('#st-count').textContent = recs.length === state.records.size
      ? `${(cur + 1).toLocaleString('en-GB')} of ${recs.length.toLocaleString('en-GB')}`
      : `${(cur + 1).toLocaleString('en-GB')} of ${recs.length.toLocaleString('en-GB')} (filtered)`;
    stage.style.setProperty('--ah', hue(r));
    const n = (r.loved || []).length;
    const love = root.querySelector('#cap-love');
    love.hidden = !n;
    love.innerHTML = n ? `${icon('heart', 14)}<span>${n} loved track${n === 1 ? '' : 's'}</span>` : '';
  }

  const onScroll = () => { if (!raf) raf = requestAnimationFrame(frame); };
  flow.addEventListener('scroll', onScroll, { passive: true });

  function scrollToIndex(i, smooth = true) {
    flow.scrollTo({ left: Math.max(0, Math.min(recs.length - 1, i)) * step, behavior: smooth && !reduce() ? 'smooth' : 'auto' });
  }

  // ---------------------------------------------------------------- pictures

  async function showPicture(fc, r, k) {
    const slides = gallerySlides(r);
    const url = await slideUrl(slides[k % Math.max(1, slides.length)]);
    const box = fc.querySelector('.cover');
    if (!url || !box) return;
    let img = box.querySelector('img');
    if (!img) { img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; box.appendChild(img); }
    img.removeAttribute('data-alt');
    img.src = url;
  }

  async function turnOver(fc, url) {
    const box = fc.querySelector('.cover');
    if (!box) return;
    let img = box.querySelector('img');
    const ease = 'perspective(900px) rotateY(';
    if (reduce()) { if (img) img.src = url; return; }
    const out = box.animate([{ transform: `${ease}0deg)` }, { transform: `${ease}-90deg)` }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
    await out.finished.catch(() => {});
    if (!img) { img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; box.appendChild(img); }
    img.removeAttribute('data-alt');
    img.src = url;
    await Promise.race([img.decode().catch(() => {}), sleep(450)]);
    const back = box.animate([{ transform: `${ease}90deg)` }, { transform: `${ease}0deg)` }], { duration: 210, easing: 'ease-out' });
    await back.finished.catch(() => {});
    out.cancel();
  }

  async function bounce(fc) {
    if (reduce()) return;
    const box = fc.querySelector('.cover');
    await box.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-16px)' }, { transform: 'translateY(0)' }], { duration: 400, easing: 'cubic-bezier(.3,.9,.3,1)' }).finished.catch(() => {});
  }

  function tellAboutPulling() {
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 2400);
  }

  async function turnMiddle() {
    if (flipping) return;
    const r = recs[cur];
    const fc = live.get(cur);
    if (!r || !fc) return;
    flipping = true;
    try {
      if (r.source === 'discogs' && r.releaseId && !(r.images && r.images.length)) {
        try { await ensureDetail(r); } catch { /* offline: use what we have */ }
      }
      const slides = gallerySlides(r);
      if (slides.length < 2) {
        await bounce(fc);
        tellAboutPulling();
        return;
      }
      const next = ((picture.get(r.id) || 0) + 1) % slides.length;
      const url = await slideUrl(slides[next]);
      await turnOver(fc, url);
      picture.set(r.id, next);
    } finally {
      flipping = false;
    }
  }

  // ---------------------------------------------------------------- opening a record

  function open(id) {
    lastId = id;
    markOpened();
    location.hash = `#/record/${id}`;
  }

  cap.addEventListener('click', () => { if (recs[cur]) open(recs[cur].id); });
  cap.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && recs[cur]) { e.preventDefault(); open(recs[cur].id); } });
  flow.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); scrollToIndex(cur + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollToIndex(cur - 1); }
    else if (e.key === 'Enter' && recs[cur]) open(recs[cur].id);
  });
  flow.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------- touch

  flow.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const fc = e.target.closest('.fc');
    if (!fc) { g = null; return; }
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), i: Number(fc.parentElement.dataset.i), fc, moved: false, pull: false, dy: 0, last: e.clientY, tl: performance.now(), v: 0 };
  });

  flow.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) g.moved = true;
    if (!g.pull && g.i === cur && dy < -12 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      g.pull = true;
      flow.setPointerCapture(e.pointerId);
      stage.classList.add('pulling');
      const box = g.fc.querySelector('.cover');
      box.getAnimations().forEach((a) => a.cancel());
      box.style.transition = 'none';
    }
    if (!g.pull) return;
    const now = performance.now();
    g.v = (e.clientY - g.last) / Math.max(1, now - g.tl);
    g.last = e.clientY;
    g.tl = now;
    g.dy = Math.min(0, dy);
    const k = Math.min(1, -g.dy / 240);
    const box = g.fc.querySelector('.cover');
    box.style.transform = `translateY(${(g.dy * 0.95).toFixed(1)}px) scale(${(1 + 0.12 * k).toFixed(3)})`;
    box.classList.toggle('ready', -g.dy > PULL_OPEN);
  });

  function letGo(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    const s = g;
    g = null;
    const box = s.fc.querySelector('.cover');
    if (s.pull) {
      stage.classList.remove('pulling');
      const fast = s.v < -0.6 && -s.dy > 40;
      if (!cancelled && (-s.dy > PULL_OPEN || fast)) {
        open(recs[s.i].id); // the sleeve stays where your finger left it, and grows into the record page
        return;
      }
      box.classList.remove('ready');
      box.style.transition = 'transform .4s cubic-bezier(.2,.9,.3,1)';
      box.style.transform = '';
      setTimeout(() => { box.style.transition = ''; }, 420);
      return;
    }
    if (cancelled || s.moved || performance.now() - s.t0 > 450) return;
    if (s.i !== cur) scrollToIndex(s.i);
    else turnMiddle();
  }
  flow.addEventListener('pointerup', (e) => letGo(e, false));
  flow.addEventListener('pointercancel', (e) => letGo(e, true));

  // ---------------------------------------------------------------- start

  if (!opened()) hint.classList.add('show');
  build(lastId);

  const ro = new ResizeObserver(() => {
    if (!recs.length) return;
    const idx = Math.max(0, cur);
    measure();
    flow.scrollLeft = idx * step;
    frame();
  });
  ro.observe(flow);

  let redraw = null;
  const off = subscribe((k) => {
    if (k !== 'records') return;
    clearTimeout(redraw);
    redraw = setTimeout(() => { build(lastId); paintPill(); }, 250);
  });

  return () => {
    off();
    ro.disconnect();
    clearTimeout(redraw);
    clearTimeout(hintTimer);
    if (raf) cancelAnimationFrame(raf);
  };
}
