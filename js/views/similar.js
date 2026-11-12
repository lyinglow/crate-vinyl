// The Similar sheet: tracks from your collection that sit close to one track.
import { state } from '../store.js';
import * as M from '../model.js';
import * as X from '../mixes.js';
import { similar, describe, profileOf } from '../features.js';
import { esc, icon, openSheet, toast, chipRow } from '../ui.js';

export function openSimilar(rec, track) {
  const mine = profileOf(rec, track);
  const opts = { decade: true, style: true, bpm: 8 };
  const s = openSheet({ title: 'Similar tracks', body: `
    <p class="muted"><b>${esc(track.title)}</b><br>${esc(rec.artist)}${mine ? ` · ${esc(describe(mine))}` : ''}</p>
    <div class="chips" id="sm-opts">
      <button type="button" class="chip on" data-o="decade">${rec.year ? `${Math.floor(rec.year / 10) * 10}s only` : 'Same decade'}</button>
      <button type="button" class="chip on" data-o="style">Same style</button>
      <button type="button" class="chip on" data-o="bpm">Tempo within 8</button>
    </div>
    <div id="sm-list"></div>
    <div class="row-btns"><button class="btn primary" id="sm-mix" hidden>Make a mix from these</button></div>
    <p class="hint-text">From the tracks you own that have a tempo and feel. Half and double speed count as close.</p>` });
  let shown = [];

  function draw() {
    const res = similar(rec, track, opts) || [];
    shown = res;
    const box = s.el.querySelector('#sm-list');
    s.el.querySelector('#sm-mix').hidden = !res.length;
    box.innerHTML = res.length ? `<div class="rows">${res.map((x, i) => `
      <a class="findrow" href="#/record/${esc(x.rec.id)}" data-i="${i}">
        <span class="ft"><b>${esc(x.track.title)}</b><span>${esc(x.rec.artist)} · ${esc(x.rec.title)}${x.rec.year ? ` · ${x.rec.year}` : ''}</span><span>${esc(describe(x.f))}</span></span>
        ${icon('chevron', 18)}
      </a>`).join('')}</div>` : '<p class="muted">Nothing else close. Try turning a filter off. Only tracks with a tempo and feel can be compared, and that grows as more are fetched in Settings.</p>';
  }
  draw();

  s.el.querySelector('#sm-opts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-o]');
    if (!b) return;
    const o = b.dataset.o;
    if (o === 'bpm') { opts.bpm = opts.bpm === 8 ? 0 : 8; b.textContent = opts.bpm ? 'Tempo within 8' : 'Any tempo'; b.classList.toggle('on', !!opts.bpm); }
    else { opts[o] = !opts[o]; b.classList.toggle('on', opts[o]); }
    draw();
  });
  s.el.querySelector('#sm-list').addEventListener('click', (e) => { if (e.target.closest('a')) s.close(); });
  s.el.querySelector('#sm-mix').onclick = async () => {
    const mix = await X.createMix(`Like ${track.title}`);
    await X.addTrack(mix.id, rec, track);
    for (const x of shown) await X.addTrack(mix.id, x.rec, x.track);
    s.close();
    toast(`Mix made with ${shown.length + 1} tracks`, { action: 'Open', onAction: () => { location.hash = `#/mixes/${mix.id}`; } });
  };
}
