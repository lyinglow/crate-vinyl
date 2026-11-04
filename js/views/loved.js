// Loved tracks: every track you have hearted, across all your records.
import { state, saveRecord, subscribe } from '../store.js';
import * as M from '../model.js';
import { esc, cover, icon, toast, debounce, hydratePhotos, $ } from '../ui.js';
import { openAddToMix, openAddManyToMix } from './mixes.js';

export function lovedItems() {
  const out = [];
  for (const rec of state.records.values()) {
    for (const key of rec.loved || []) {
      const [position, ...rest] = key.split('|');
      const track = (rec.tracklist || []).find((t) => M.trackKey(t) === key) || { position, title: rest.join('|'), duration: '' };
      out.push({ rec, track, key });
    }
  }
  out.sort((a, b) => {
    const k = M.sortKey(a.rec).localeCompare(M.sortKey(b.rec));
    return k || M.norm(a.rec.title).localeCompare(M.norm(b.rec.title)) || a.track.position.localeCompare(b.track.position, undefined, { numeric: true });
  });
  return out;
}

export const lovedCount = () => lovedItems().length;

export function mount(root) {
  let q = '';
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/library">${icon('back', 20)} Library</a>
      <div class="largetitle"><h1>Loved tracks</h1><p class="sub" id="lv-sub"></p></div>
      <div id="lv-tools"></div>
      <div id="lv-body"></div>
    </div>`;

  let shown = [];
  function draw() {
    const all = lovedItems();
    const words = M.norm(q).split(/\s+/).filter(Boolean);
    shown = all.filter((x) => {
      const h = M.norm(`${x.rec.artist} ${x.rec.title} ${x.track.title}`);
      return words.every((w) => h.includes(w));
    });
    $('#lv-sub', root).textContent = all.length ? (shown.length === all.length ? `${all.length} track${all.length === 1 ? '' : 's'}` : `${shown.length} of ${all.length}`) : '';
    $('#lv-tools', root).innerHTML = all.length ? `
      <label class="search" style="margin-top:6px">${icon('search', 18)}<input id="lq" type="search" placeholder="Search loved tracks" autocomplete="off" autocapitalize="off" value="${esc(q)}"></label>
      ${shown.length ? `<div class="mixhead"><button class="btn small primary" id="add-all">${icon('plus', 16)} Add ${shown.length === all.length ? 'all' : shown.length} to a mix</button></div>` : ''}` : '';
    $('#lv-body', root).innerHTML = shown.length
      ? `<div class="rows" style="margin-top:8px">${shown.map((x) => `
        <div class="lv-row" data-rec="${x.rec.id}">
          <div class="mthumb">${cover(x.rec, { small: true })}</div>
          <div class="mtext"><b>${esc(x.track.title)}</b><span>${esc(x.rec.artist)} · ${esc(x.rec.title)}</span></div>
          <span class="md">${esc(x.track.duration)}</span>
          <span class="tbtns"><button class="heart on" data-unheart="${x.rec.id}" data-key="${esc(x.key)}" aria-label="Remove from loved">${icon('heart', 18)}</button><button class="add-mix" data-addone="${x.rec.id}" data-key="${esc(x.key)}" aria-label="Add to a mix">${icon('plus', 18)}</button></span>
        </div>`).join('')}</div>`
      : `<div class="empty small"><p>${all.length ? 'Nothing matches that.' : 'No loved tracks yet. Open a record and tap the heart next to a track.'}</p></div>`;
    hydratePhotos(root);
    const input = $('#lq', root);
    if (input) input.oninput = debounce(() => { q = input.value; draw(); const i = $('#lq', root); i.focus(); i.setSelectionRange(q.length, q.length); }, 150);
    const addAll = $('#add-all', root);
    if (addAll) addAll.onclick = () => openAddManyToMix(shown.map((x) => ({ rec: x.rec, track: x.track })));
  }
  draw();

  const find = (el) => {
    const rec = state.records.get(el.dataset.unheart || el.dataset.addone);
    const item = lovedItems().find((x) => x.rec.id === rec.id && x.key === el.dataset.key);
    return { rec, item };
  };

  root.addEventListener('click', async (e) => {
    const un = e.target.closest('[data-unheart]');
    if (un) {
      const { rec } = find(un);
      const key = un.dataset.key;
      rec.loved = (rec.loved || []).filter((k) => k !== key);
      await saveRecord(rec, { quiet: true });
      draw();
      toast('Removed from loved', {
        action: 'Undo',
        onAction: async () => { rec.loved = [...(rec.loved || []), key]; await saveRecord(rec, { quiet: true }); draw(); },
      });
      return;
    }
    const add = e.target.closest('[data-addone]');
    if (add) {
      const { item } = find(add);
      if (item) openAddToMix(item.rec, item.track);
      return;
    }
    const row = e.target.closest('[data-rec]');
    if (row) location.hash = `#/record/${row.dataset.rec}`;
  });

  return subscribe((k) => { if (k === 'records') draw(); });
}
