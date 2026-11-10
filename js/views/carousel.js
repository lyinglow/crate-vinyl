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
import { photoUrl } from '../store.js';
import { filterState as F, filtersOn } from './library.js';
import { gallerySlides, slideUrl } from '../gallery.js';
import { openGenreSheet, genreLabel, genreOn } from './genres.js';
import { ensureDetail } from '../sync.js';

const picCache = new Map(); // each sleeve's tiny colour copies, kept between visits so colours are ready before you scroll to them
const LIVE = 6; // sleeves drawn on each side of the middle
const BLOCKS = { pixel: 14, soft: 30 }; // how many screen pixels wide each pixel of the background is
const hash = (s) => { let h = 2166136261; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; };
let grainUrl = '';
// A square of random speckle, made once. Light and dark specks, each partly see-through.
function grainTexture() {
  if (grainUrl) return grainUrl;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const d = g.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) {
    const v = Math.random() * 255;
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v;
    d.data[i * 4 + 3] = 55 + Math.random() * 60;
  }
  g.putImageData(d, 0, 0);
  grainUrl = c.toDataURL('image/png');
  return grainUrl;
}
const CAN_FILTER = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
const PULL_OPEN = 90; // pixels you must pull up to open a record
const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let spinSoon = false; // set by Settings, so "Spin now" shows it working
export function spinNow() { spinSoon = true; }
// A short memory of how the row moved, so Settings can show what this phone really does while you scroll.
const trace = [];
const centres = [];
export function scrollReport() {
  const bursts = [];
  let cur = [];
  for (const p of trace) {
    if (cur.length && p[0] - cur[cur.length - 1][0] > 250) { bursts.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) bursts.push(cur);
  const real = bursts.filter((b) => b.length >= 8).slice(-3);
  const lines = [`Crate scroll check`, `Samples kept: ${trace.length}. Scrolls found: ${real.length}.`];
  real.forEach((b, i) => {
    const dts = [];
    const dxs = [];
    for (let k = 1; k < b.length; k++) { dts.push(b[k][0] - b[k - 1][0]); dxs.push(b[k][1] - b[k - 1][1]); }
    const total = b[b.length - 1][1] - b[0][1];
    const dir = total >= 0 ? 1 : -1;
    const moving = dxs.filter((d) => Math.abs(d) >= 0.5);
    let flips = 0;
    for (let k = 1; k < moving.length; k++) if (Math.sign(moving[k]) !== Math.sign(moving[k - 1])) flips++;
    const back = moving.filter((d) => Math.sign(d) !== dir);
    const maxBack = back.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
    const sorted = [...dts].sort((a, c) => a - c);
    lines.push(`Scroll ${i + 1}: ${b.length} frames over ${Math.round(b[b.length - 1][0] - b[0][0])} ms, moved ${Math.round(total)} px. Typical gap ${sorted[sorted.length >> 1].toFixed(1)} ms. Gaps over 25 ms: ${dts.filter((d) => d > 25).length}. Longest gap ${Math.round(Math.max(...dts))} ms. Direction changes: ${flips}. Biggest step backwards: ${maxBack.toFixed(1)} px.`);
  });
  let bounce = 0;
  for (let k = 2; k < centres.length; k++) if (centres[k][1] === centres[k - 2][1] && centres[k][0] - centres[k - 2][0] < 400) bounce++;
  lines.push(`Middle record flipped back and forth: ${bounce} times.`);
  lines.push(`Phone: ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90)}. Pixel ratio ${window.devicePixelRatio}.`);
  return lines.join('\n');
}
let lastId = null; // the record that was in the middle when you last left
const picture = new Map(); // record id to the picture number showing in the flow

const opened = () => { try { return localStorage.getItem('crate.opened') === '1'; } catch { return false; } };
const markOpened = () => { try { localStorage.setItem('crate.opened', '1'); } catch { /* fine */ } };

export function mount(root) {
  root.innerHTML = `
    <div class="stage" id="stage">
      <div class="ambient-wrap" id="ambwrap" aria-hidden="true"><canvas class="ambient" id="amb" width="40" height="60"></canvas></div>
      <div class="grain" id="grain" aria-hidden="true"></div>
      <div class="stage-top">
        <div><div class="stage-title">Library</div><div class="stage-sub" id="st-count"></div></div>
        <div class="stage-actions">
          <button class="pill-btn" id="genre-pill" aria-label="Filter by genre"></button>
          <a class="icon-btn" href="#/browse" aria-label="Browse as a grid. Search and filter.">${icon('grid', 22)}<i class="dot" id="st-dot" hidden></i></a>
        </div>
      </div>
      <div class="flow" id="flow" tabindex="0" aria-label="Your records. Swipe sideways to browse."></div>
      <div class="cap" id="cap" role="button" tabindex="0" aria-live="polite" aria-label="Open this record">
        <div class="cap-artist"></div><div class="cap-title"></div><div class="cap-meta"></div><div class="cap-love" id="cap-love" style="visibility:hidden"></div>
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
  pill.onclick = () => openGenreSheet(() => { build(lastId); paintPill(); armIdle(); });

  // ---------------------------------------------------------------- the colour behind
  // A tiny canvas, stretched to fill the screen and blurred by CSS. The sleeves near the middle are
  // drawn on it small, so their colours melt into each other and slide as you scroll. Drawing an image
  // is allowed even from another site. Reading its pixels is not, which is why this does it by painting.
  const bg = ['soft', 'pixel', 'off'].includes(state.settings.bgStyle) ? state.settings.bgStyle : 'soft';
  const BLOCK = BLOCKS[bg] || BLOCKS.soft;
  stage.classList.add(`bg-${bg}`);
  const amb = root.querySelector('#amb');
  const ambWrap = root.querySelector('#ambwrap');
  const grain = root.querySelector('#grain');
  grain.style.backgroundImage = `url(${grainTexture()})`;
  grain.style.backgroundSize = `${(128 / (window.devicePixelRatio || 1)).toFixed(2)}px`;
  const actx = amb.getContext('2d');
  let lastPos = 0;
  let drawn = 0;

  // Each sleeve is shrunk once to a tiny copy. Turning a big photo around many times a second is slow.
  // A sleeve whose picture has not arrived yet is left out of the blend, so its colour never pops in.
  const repaint = () => paintAmbient(lastPos);
  function pic(r) {
    const key = r.cover || r.thumb || (r.photoSleeve ? `photo:${r.photoSleeve}` : '');
    let entry = picCache.get(r.id);
    if (entry && entry.key === key) {
      if (entry.state === 'loading') entry.listeners.add(repaint);
      return entry;
    }
    entry = { key, small: null, tiny: null, blob: null, state: key ? 'loading' : 'none', listeners: new Set([repaint]) };
    picCache.delete(r.id);
    picCache.set(r.id, entry);
    if (picCache.size > 600) picCache.delete(picCache.keys().next().value);
    const done = (state) => { entry.state = state; entry.listeners.forEach((f) => f()); entry.listeners.clear(); };
    const make = (url) => {
      const im = new Image();
      im.decoding = 'async';
      im.referrerPolicy = 'no-referrer';
      im.onerror = () => done('failed');
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = 40;
        c.height = 40;
        c.getContext('2d').drawImage(im, 0, 0, 40, 40);
        entry.small = c;
        // The middle of the sleeve shrunk to 3 by 3: nine averaged colours. The edge is skipped, because
        // white borders would turn every colour grey. Stretched smoothly, the nine make a pale gradient.
        const t = document.createElement('canvas');
        t.width = 3;
        t.height = 3;
        const tg = t.getContext('2d');
        tg.imageSmoothingQuality = 'high';
        tg.drawImage(c, 7, 7, 26, 26, 0, 0, 3, 3);
        entry.tiny = t;
        // A soft round blob made from those nine colours, fading to nothing at its rim. Drawn instead of a
        // flat square so no hard edge ever sweeps across the screen as you scroll.
        const bl = document.createElement('canvas');
        bl.width = 48;
        bl.height = 48;
        const bc = bl.getContext('2d');
        bc.imageSmoothingEnabled = true;
        bc.imageSmoothingQuality = 'high';
        bc.drawImage(t, 0, 0, 48, 48);
        bc.globalCompositeOperation = 'destination-in';
        const rim = bc.createRadialGradient(24, 24, 0, 24, 24, 24);
        rim.addColorStop(0, 'rgba(0,0,0,1)');
        rim.addColorStop(0.6, 'rgba(0,0,0,1)');
        rim.addColorStop(1, 'rgba(0,0,0,0)');
        bc.fillStyle = rim;
        bc.fillRect(0, 0, 48, 48);
        entry.blob = bl;
        done('ready');
      };
      im.src = url;
    };
    if (r.cover || r.thumb) make(r.cover || r.thumb);
    else if (r.photoSleeve) photoUrl(r.photoSleeve).then((u) => { if (u) make(u); else done('failed'); });
    return entry;
  }

  let lite = false; // a slow phone (Low Power Mode, say): fewer repaints and no idle animation
  let paintN = 0;
  function paintAmbient(pos) {
    lastPos = pos;
    if (!recs.length || bg === 'off') return;
    if (lite && (paintN++ & 1)) return;
    const mid = Math.max(0, Math.min(recs.length - 1, Math.round(pos)));
    const W = amb.width;
    const H = amb.height;
    actx.filter = 'none';
    actx.globalAlpha = 1;
    // The plain colour underneath fades from one record's colour to the next, so it never switches at the halfway point.
    const base = (i) => `hsl(${hue(recs[Math.max(0, Math.min(recs.length - 1, i))])} ${bg === 'pixel' ? 38 : 70}% ${bg === 'pixel' ? 58 : 56}%)`;
    const i0 = Math.floor(pos);
    const frac = Math.max(0, Math.min(1, pos - i0));
    actx.fillStyle = base(i0);
    actx.fillRect(0, 0, W, H);
    if (frac > 0.001) { actx.globalAlpha = frac; actx.fillStyle = base(i0 + 1); actx.fillRect(0, 0, W, H); actx.globalAlpha = 1; }
    // A small canvas that the screen shows as big square blocks (that is the pixelation). Each sleeve
    // is drawn as a large shape at its own angle, position and size, worked out from its id so a record
    // always looks the same.
    if (CAN_FILTER) actx.filter = bg === 'pixel' ? 'saturate(1.5)' : 'blur(1.2px) saturate(3.6) contrast(1.2)';
    const near = [];
    for (let i = mid - 3; i <= mid + 3; i++) {
      if (i < 0 || i >= recs.length) continue;
      const d = i - pos;
      if (Math.abs(d) < 2.6) near.push([i, d]);
    }
    near.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); // furthest first, so the middle sits on top
    // Each shape is laid down with its share of the total so far (a running average). That makes the
    // result the same whichever shape goes first, so when two records swap places in the middle nothing
    // jumps. Stacking them with fixed strength made the colour pop halfway between two sleeves.
    let shared = 0.2; // the plain fill underneath counts a little
    for (const [i, d] of near) {
      const r = recs[i];
      const p = pic(r);
      if (p.state === 'loading') continue;
      const h = hash(r.id);
      const w = Math.pow(Math.max(0, 1 - Math.abs(d) / 2.4), 3);
      shared += w;
      const a = w / shared;
      const size = W * ((bg === 'pixel' ? 1.0 : 1.5) + ((h >>> 17) % 70) / 100) * (1 - Math.abs(d) * 0.08);
      const cx = W / 2 + d * W * 0.3 + (((h >>> 3) % 100) / 100 - 0.5) * W * 0.3;
      const cy = H * 0.46 + (((h >>> 9) % 100) / 100 - 0.5) * H * 0.34;
      const tilt = (h % 360) * (Math.PI / 180); // any angle at all
      actx.save();
      actx.globalAlpha = a;
      actx.translate(cx, cy);
      actx.rotate(tilt);
      const src = bg === 'pixel' ? p.small : p.blob;
      if (src) actx.drawImage(src, -size / 2, -size / 2, size, size);
      else { actx.fillStyle = `hsl(${hue(r)} 40% 55%)`; actx.fillRect(-size / 2, -size / 2, size, size); }
      actx.restore();
    }
    actx.filter = 'none';
    if (bg === 'soft') { actx.globalAlpha = 0.05; actx.fillStyle = '#fff'; actx.fillRect(0, 0, W, H); } // lifts the darkest patches
    actx.globalAlpha = 1;
    amb.dataset.mid = recs[mid].id;
    amb.dataset.drawn = String(++drawn);
  }

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

  let hStable = 0;
  function measure() {
    const w = flow.clientWidth || 360;
    const h = flow.clientHeight || 520;
    // Small changes in height (a sync bar, a line of text) must not resize the sleeves, so only act on a real one.
    if (!hStable || Math.abs(h - hStable) >= 40) hStable = h;
    C = Math.round(Math.max(150, Math.min(340, w * 0.72, hStable * 0.52)));
    step = Math.max(40, Math.round(C * 0.34));
    const bucket = (n) => Math.ceil(n / 64) * 64; // so a line of text more or less never resizes the canvas
    const cw = Math.ceil((bucket(stage.clientWidth || 390) * 1.5) / BLOCK);
    const ch = Math.ceil((bucket(stage.clientHeight || 700) * 1.5) / BLOCK);
    if (amb.width !== cw || amb.height !== ch) {
      amb.width = cw;
      amb.height = ch;
      amb.style.width = `${cw}px`;
      amb.style.height = `${ch}px`;
      ambWrap.style.width = `${cw}px`;
      ambWrap.style.height = `${ch}px`;
      ambWrap.style.margin = `${-ch / 2}px 0 0 ${-cw / 2}px`;
      ambWrap.style.setProperty('--amb-scale', String(BLOCK));
      // how far the colour wanders, in canvas pixels: about a tenth of the screen each way
      ambWrap.style.setProperty('--mx', `${((stage.clientWidth || 390) * 0.1) / BLOCK}px`);
      ambWrap.style.setProperty('--my', `${((stage.clientHeight || 700) * 0.1) / BLOCK}px`);
    }
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
    // Solid while they can overlap, so one never shows through another. Only the far edge fades.
    el.style.opacity = a <= 2 ? '1' : String(Math.max(0.35, 1 - 0.3 * (a - 2)).toFixed(3));
    // Closer to the middle sits on top. Fine steps, and a fixed winner on a tie, so the order never flickers.
    el.style.zIndex = String(10000 - Math.round(a * 400) * 2 - (d > 0 ? 1 : 0));
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

  const dts = [];
  let lastT = 0;
  let prewarmT = null;
  function watchSpeed() {
    const now = performance.now();
    if (lastT && now - lastT < 200) {
      dts.push(now - lastT);
      if (dts.length > 30) dts.shift();
      if (dts.length >= 20) {
        const m = [...dts].sort((a, b) => a - b)[dts.length >> 1];
        const want = lite ? m > 20 : m > 27;
        if (want !== lite) { lite = want; stage.classList.toggle('lite', lite); }
      }
    }
    lastT = now;
  }

  function frame() {
    raf = 0;
    if (!recs.length) return;
    watchSpeed();
    trace.push([performance.now(), flow.scrollLeft]);
    if (trace.length > 1500) trace.splice(0, 300);
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
    paintAmbient(pos);
    const center = Math.max(0, Math.min(recs.length - 1, Math.round(pos)));
    if (center !== cur) {
      cur = center;
      centres.push([performance.now(), center]);
      if (centres.length > 200) centres.splice(0, 50);
      caption();
      // Once the flick settles, get the pictures ready for the sleeves on both sides.
      clearTimeout(prewarmT);
      prewarmT = setTimeout(() => { for (let k = -8; k <= 8; k++) { const q = recs[cur + k]; if (q) pic(q); } }, 140);
    }
    // Only the sleeve in the middle may morph into the record page.
    const mid = live.get(cur);
    if (mid && !vtEl) setViewName(mid); // once per build, for the way back from a record. It moves when you open one.
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
    love.style.visibility = n ? 'visible' : 'hidden'; // keeps its space, so the sleeves never change size between records
    love.innerHTML = n ? `${icon('heart', 14)}<span>${n} loved track${n === 1 ? '' : 's'}</span>` : '';
  }

  let lastMove = 0; // when the row last moved, so a sleeve never turns over while you scroll
  const onScroll = () => { lastMove = performance.now(); abortTurn(); if (!raf) raf = requestAnimationFrame(frame); };
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

  // A turn in flight is dropped the moment you touch or scroll, so a half-turned sleeve is never
  // left sliding over its neighbour.
  let turnId = 0;
  function abortTurn() {
    if (!flipping) return; // nothing in flight, so no need to touch the sleeves while you scroll
    turnId++;
    for (const el of live.values()) {
      const box = el.querySelector('.cover');
      if (box) box.getAnimations().forEach((an) => an.cancel());
    }
    if (flipping) flipping = false;
  }

  async function turnOver(fc, url) {
    const box = fc.querySelector('.cover');
    if (!box) return false;
    const id = ++turnId;
    let img = box.querySelector('img');
    const ease = 'perspective(900px) rotateY(';
    if (reduce()) { if (img) img.src = url; return true; }
    const out = box.animate([{ transform: `${ease}0deg)` }, { transform: `${ease}-90deg)` }], { duration: 170, easing: 'ease-in', fill: 'forwards' });
    await out.finished.catch(() => {});
    if (id !== turnId) { out.cancel(); return false; }
    if (!img) { img = new Image(); img.alt = ''; img.referrerPolicy = 'no-referrer'; box.appendChild(img); }
    img.removeAttribute('data-alt');
    img.src = url;
    await Promise.race([img.decode().catch(() => {}), sleep(450)]);
    if (id !== turnId) { out.cancel(); return true; }
    const back = box.animate([{ transform: `${ease}90deg)` }, { transform: `${ease}0deg)` }], { duration: 210, easing: 'ease-out' });
    await back.finished.catch(() => {});
    out.cancel();
    return true;
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

  async function turnMiddle(auto) {
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
        if (auto) return; // nothing to turn to, so stay still
        await bounce(fc);
        tellAboutPulling();
        return;
      }
      const next = ((picture.get(r.id) || 0) + 1) % slides.length;
      const url = await slideUrl(slides[next]);
      if (await turnOver(fc, url)) picture.set(r.id, next);
    } finally {
      flipping = false;
    }
  }

  // ---------------------------------------------------------------- opening a record

  function setViewName(el) {
    if (vtEl && vtEl.firstElementChild) vtEl.firstElementChild.style.viewTransitionName = '';
    if (el && el.firstElementChild) el.firstElementChild.style.viewTransitionName = 'cover';
    vtEl = el;
  }

  function open(id) {
    const at = recs.findIndex((x) => x.id === id);
    if (live.has(at)) setViewName(live.get(at));
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

  // ---------------------------------------------------------------- the idle turn
  // Leave the cover flow alone for a while and the sleeve in the middle turns over by itself, once, the same
  // as a tap: the next picture of that record (back, label, inner). Any touch, key or scroll restarts
  // the wait. Settings sets how long it waits, or turns it off.

  const waitSeconds = () => { const n = Number(state.settings.autoSpin); return Number.isFinite(n) ? n : 2; };
  let idleTimer = null;
  const stopSpin = () => {};

  function armIdle() {
    clearTimeout(idleTimer);
    const n = waitSeconds();
    if (!n || n < 0 || reduce()) return;
    idleTimer = setTimeout(spin, n * 1000);
  }

  async function spin(force) {
    if (g && performance.now() - g.t0 > 10000) g = null; // a touch that never reported its end
    if (!live.get(cur) || document.hidden || g || flipping || (!force && performance.now() - lastMove < 1500) || stage.classList.contains('pulling') || document.querySelector('.sheet-wrap.in')) { armIdle(); return; }
    await turnMiddle(true); // once. It turns again only after you touch the screen and leave it alone again
  }

  const touched = () => { abortTurn(); armIdle(); };
  if (spinSoon) { spinSoon = false; setTimeout(() => spin(true), 700); }
  const touchEvents = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  touchEvents.forEach((n) => document.addEventListener(n, touched, { capture: true, passive: true }));
  const onSeen = () => { stopSpin(); armIdle(); };
  document.addEventListener('visibilitychange', onSeen);

  // ---------------------------------------------------------------- start

  if (!opened()) hint.classList.add('show');
  build(lastId);

  const ro = new ResizeObserver(() => {
    if (!recs.length) return;
    const oldStep = step;
    const oldC = C;
    const at = flow.scrollLeft / oldStep; // where you are, in sleeves, to a fraction
    measure();
    // A change in height alone (a caption with an extra line, the sync bar showing) must never move the
    // scroll. Only a real change of sleeve size does, and then you keep your place.
    if (step === oldStep && C === oldC) { paintAmbient(lastPos); return; }
    flow.scrollLeft = at * step;
    frame();
  });
  ro.observe(flow);

  let redraw = null;
  const off = subscribe((k) => {
    if (k !== 'records') return;
    clearTimeout(redraw);
    redraw = setTimeout(() => { build(lastId); paintPill(); armIdle(); }, 250);
  });

  armIdle();

  return () => {
    off();
    clearTimeout(idleTimer);
    clearTimeout(prewarmT);
    stopSpin();
    touchEvents.forEach((n) => document.removeEventListener(n, touched, { capture: true }));
    document.removeEventListener('visibilitychange', onSeen);
    ro.disconnect();
    clearTimeout(redraw);
    clearTimeout(hintTimer);
    if (raf) cancelAnimationFrame(raf);
  };
}
