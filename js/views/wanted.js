// The wanted list: records you are looking for. They stay out of your library, value and playlists.
import { state, subscribe } from '../store.js';
import * as M from '../model.js';
import { esc, cover, icon, toast, confirmSheet, hydratePhotos, $ } from '../ui.js';
import { setWanted } from '../target.js';
import { gotIt, removeWanted } from '../sync.js';

export const wantedRecords = () => [...state.records.values()].filter((r) => r.wanted);

export function priceLine(r) {
  const m = r.market;
  if (!m || m.lowest == null) return '';
  const cur = m.currency || state.settings.currency;
  return `From ${M.money(m.lowest, cur)}${m.numForSale ? ` · ${m.numForSale.toLocaleString('en-GB')} for sale` : ''}`;
}

export function mount(root) {
  let q = '';
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/library">${icon('back', 20)} Library</a>
      <div class="largetitle"><h1>Wanted</h1><p class="sub" id="w-sub"></p></div>
      <div class="row-btns"><a class="btn primary" id="w-add" href="#/scan">Add a record I want</a></div>
      <input type="search" id="w-q" class="vfilter" placeholder="Search your wanted list" autocomplete="off" autocapitalize="off">
      <div id="w-list"></div>
    </div>`;

  function draw() {
    const all = wantedRecords();
    const list = M.sortRecords(M.filterRecords([...state.records.values()], { q, status: 'all', wanted: true }), 'artist');
    $('#w-sub', root).textContent = all.length ? `${all.length.toLocaleString('en-GB')} record${all.length === 1 ? '' : 's'} you are after` : '';
    $('#w-q', root).hidden = all.length < 6;
    if (!all.length) {
      $('#w-list', root).innerHTML = `<div class="empty small"><p>Nothing here yet.</p><p class="muted">Scan or search for a record, then choose <b>Wanted list</b> under Adding to. It also goes on your Discogs wantlist.</p></div>`;
      return;
    }
    $('#w-list', root).innerHTML = list.map((r) => {
      const price = priceLine(r);
      return `<div class="wrow" data-id="${esc(r.id)}">
        <a class="wmain" href="#/record/${esc(r.id)}">
          <div class="wthumb">${cover(r, { small: true })}</div>
          <div class="wtext"><b>${esc(r.artist || 'Unknown artist')}</b><span>${esc(r.title)}</span><span>${esc([r.label, r.catno, r.year].filter(Boolean).join(' · '))}</span>${price ? `<span class="wprice">${esc(price)}</span>` : ''}</div>
        </a>
        <button class="btn small" data-got="${esc(r.id)}">I got it</button>
      </div>`;
    }).join('') || '<p class="muted">Nothing matches that.</p>';
    hydratePhotos($('#w-list', root));
  }

  $('#w-add', root).onclick = () => setWanted(true);
  $('#w-q', root).oninput = (e) => { q = e.target.value; draw(); };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-got]');
    if (!b) return;
    const r = state.records.get(b.dataset.got);
    if (!r) return;
    const ok = await confirmSheet({ title: 'Got it?', text: `${r.artist}, ${r.title}\n\nIt moves to your library. Set its grade on its record page.`, yes: 'Move to my library' });
    if (!ok) return;
    await gotIt(r);
    toast(`${r.title} is in your library`);
  });

  draw();
  const off = subscribe((k) => { if (k === 'records') draw(); });
  return () => off();
}
