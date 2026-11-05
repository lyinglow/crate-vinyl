// The big picture on a record page. Tap it and it turns over to the next picture.
// Drag it sideways and it turns with your finger. Let go past halfway and it finishes
// the turn. Let go early and it swings back.
import { esc, hue } from './ui.js';
import { gallerySlides, slideUrl, preload } from './gallery.js';

const reduce = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const pose = (a) => `rotateY(${a}deg) scale(${1 - 0.06 * Math.sin((Math.min(Math.abs(a), 180) * Math.PI) / 180)})`;

export function mountFlipper(host, rec, { start = 0, onIndex = null, vtName = false } = {}) {
  let slides = gallerySlides(rec);
  if (!slides.length) slides = [{}];
  const n = slides.length;
  let idx = Math.min(start, n - 1);
  let busy = false;
  let angle = 0;
  let dir = 0; // +1: the back shows the next picture. -1: the previous one.

  host.innerHTML = `<div class="flipper" tabindex="0" role="group" aria-label="Picture ${idx + 1} of ${n}. ${n > 1 ? 'Tap or drag to see the next picture.' : ''}"${vtName ? ' style="view-transition-name:cover"' : ''}>
      <div class="flip-card"><div class="face front"></div><div class="face back"></div></div>
    </div>${n > 1 ? `<div class="dots" aria-hidden="true">${slides.map((_, i) => `<i class="${i === idx ? 'on' : ''}"></i>`).join('')}</div>` : ''}`;
  const el = host.querySelector('.flipper');
  const card = host.querySelector('.flip-card');
  const front = host.querySelector('.front');
  const back = host.querySelector('.back');
  const dots = [...host.querySelectorAll('.dots i')];
  const ph = `<span class="ph"><b>${esc(rec.artist)}</b>${esc(rec.title)}</span>`;

  async function paint(face, slide) {
    face.innerHTML = `<div class="cover" style="--h:${hue(rec)}">${ph}</div>`;
    const box = face.firstElementChild;
    const url = await slideUrl(slide);
    if (!url) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    box.appendChild(img);
  }

  function warm() {
    [(idx + 1) % n, (idx - 1 + n) % n].forEach((i) => slideUrl(slides[i]).then(preload));
  }

  function setBack(d) {
    if (d === dir) return;
    dir = d;
    paint(back, slides[(idx + d + n) % n]);
  }

  // Turn the card to an angle, smoothly. Resolves when it arrives.
  async function spin(to) {
    const from = angle;
    angle = to;
    const ms = reduce() ? 0 : Math.round(280 + 320 * (Math.abs(to - from) / 180));
    if (!ms || from === to) {
      card.style.transform = pose(to);
      return;
    }
    const a = card.animate(
      [{ transform: pose(from) }, { transform: pose((from + to) / 2) }, { transform: pose(to) }],
      { duration: ms, easing: 'cubic-bezier(.25,.8,.25,1)' },
    );
    card.style.transform = pose(to);
    try { await a.finished; } catch { /* cancelled */ }
  }

  // The turn is done. The back face becomes the front.
  function finish(d) {
    idx = (idx + d + n) % n;
    front.replaceChildren(...back.childNodes);
    card.style.transform = pose(0);
    angle = 0;
    dir = 0;
    back.innerHTML = '';
    dots.forEach((x, i) => x.classList.toggle('on', i === idx));
    el.setAttribute('aria-label', `Picture ${idx + 1} of ${n}. Tap or drag to see the next picture.`);
    warm();
    if (onIndex) onIndex(idx);
  }

  async function flipBy(d) {
    if (busy) return;
    busy = true;
    if (n === 1) {
      await wiggle();
    } else {
      setBack(d);
      await spin(d > 0 ? -180 : 180);
      finish(d);
    }
    busy = false;
  }

  async function wiggle() {
    if (reduce()) return;
    const a = card.animate(
      [{ transform: pose(0) }, { transform: pose(16) }, { transform: pose(-9) }, { transform: pose(0) }],
      { duration: 480, easing: 'cubic-bezier(.3,.8,.3,1)' },
    );
    try { await a.finished; } catch { /* cancelled */ }
  }

  paint(front, slides[idx]);
  warm();

  // ---- touch and mouse
  let g = null;
  el.addEventListener('pointerdown', (e) => {
    if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const now = performance.now();
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: now, drag: false, last: e.clientX, tl: now, v: 0 };
  });

  el.addEventListener('pointermove', (e) => {
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.drag) {
      if (Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
        g.drag = true;
        el.setPointerCapture(e.pointerId);
        el.classList.add('dragging');
      } else {
        return;
      }
    }
    const now = performance.now();
    g.v = (e.clientX - g.last) / Math.max(1, now - g.tl);
    g.last = e.clientX;
    g.tl = now;
    const w = el.clientWidth || 300;
    if (n > 1) {
      angle = Math.max(-180, Math.min(180, (dx / w) * 200));
      setBack(angle < 0 ? 1 : -1);
    } else {
      angle = Math.max(-22, Math.min(22, (dx / w) * 60)); // nothing to turn to: a little give, then it springs back
    }
    card.style.transform = pose(angle);
  });

  async function release(e, cancelled) {
    if (!g || e.pointerId !== g.id) return;
    const s = g;
    g = null;
    el.classList.remove('dragging');
    if (!s.drag) {
      if (!cancelled && performance.now() - s.t0 < 450) flipBy(1);
      return;
    }
    const fast = Math.abs(s.v) > 0.5 && Math.sign(s.v) === Math.sign(angle);
    const commit = !cancelled && n > 1 && (Math.abs(angle) > 70 || (fast && Math.abs(angle) > 20));
    busy = true;
    if (commit) {
      const d = angle < 0 ? 1 : -1;
      await spin(angle < 0 ? -180 : 180);
      finish(d);
    } else {
      await spin(0);
      dir = 0;
    }
    busy = false;
  }
  el.addEventListener('pointerup', (e) => release(e, false));
  el.addEventListener('pointercancel', (e) => release(e, true));

  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flipBy(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); flipBy(-1); }
  });

  return { count: n, index: () => idx };
}
