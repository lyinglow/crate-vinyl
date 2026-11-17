// Fill in what you paid, for the records you already own. Type a price and it saves.
import { state, saveRecord } from '../store.js';
import * as M from '../model.js';
import { esc, cover, icon, toast, hydratePhotos, $ } from '../ui.js';

let q = '';
let shown = 40;
let onlyMissing = true;

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/value">${icon('back', 20)} Value</a>
      <div class="largetitle"><h1>What you paid</h1><p class="sub" id="pd-sub"></p></div>
      <p class="muted">Type a price against each record. It saves as you go. Leave out the ones you cannot remember.</p>
      <input type="search" id="pd-q" class="vfilter" placeholder="Search by artist, title or label" autocomplete="off" autocapitalize="off" value="${esc(q)}">
      <label class="check"><input type="checkbox" id="pd-missing"${onlyMissing ? ' checked' : ''}> Only records with no price yet</label>
      <div id="pd-list"></div>
    </div>`;

  const owned = () => [...state.records.values()].filter((r) => !r.wanted && r.status !== 'sold');
  const hasPaid = (r) => r.paid != null && r.paid !== '';

  function draw() {
    const all = owned();
    const done = all.filter(hasPaid).length;
    $('#pd-sub', root).textContent = `${done.toLocaleString('en-GB')} of ${all.length.toLocaleString('en-GB')} done`;
    let list = M.filterRecords(all, { q, status: 'all' });
    if (onlyMissing) list = list.filter((r) => !hasPaid(r));
    list = M.sortRecords(list, 'artist');
    const el = $('#pd-list', root);
    if (!list.length) { el.innerHTML = `<div class="empty small"><p>${all.length && done === all.length ? 'Every record has a price.' : 'Nothing matches.'}</p></div>`; return; }
    el.innerHTML = list.slice(0, shown).map((r) => `<div class="lrow pdrow" data-id="${esc(r.id)}">
        <div class="lthumb">${cover(r, { small: true })}</div>
        <div class="ltext"><b>${esc(r.artist)}</b><span>${esc(r.title)}</span><small>${esc([r.year, r.label].filter(Boolean).join(' · '))}</small></div>
        <input class="pd-in" inputmode="decimal" placeholder="£" value="${hasPaid(r) ? esc(String(r.paid)) : ''}" aria-label="Price paid for ${esc(r.title)}" autocomplete="off">
      </div>`).join('') + (list.length > shown ? `<button class="btn small" id="pd-more">Show more (${(list.length - shown).toLocaleString('en-GB')} left)</button>` : '');
    hydratePhotos(el);
  }

  root.addEventListener('change', async (e) => {
    const inp = e.target.closest('.pd-in');
    if (!inp) return;
    const r = state.records.get(inp.closest('[data-id]').dataset.id);
    if (!r) return;
    const v = inp.value.replace(/[^0-9.]/g, '');
    r.paid = v === '' ? null : Number(v);
    if (r.paid != null && !r.paidOn) r.paidOn = '';
    await saveRecord(r, { quiet: true });
    // The row stays where it is until you move on, so the list does not jump while you type.
    const left = owned().filter((x) => !hasPaid(x)).length;
    $('#pd-sub', root).textContent = `${(owned().length - left).toLocaleString('en-GB')} of ${owned().length.toLocaleString('en-GB')} done`;
  });
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('pd-in')) return;
    e.preventDefault();
    const rows = [...root.querySelectorAll('.pd-in')];
    const next = rows[rows.indexOf(e.target) + 1];
    e.target.blur();
    if (next) next.focus();
  });
  root.addEventListener('click', (e) => { if (e.target.closest('#pd-more')) { shown += 40; draw(); } });
  $('#pd-q', root).oninput = (e) => { q = e.target.value; shown = 40; draw(); };
  $('#pd-missing', root).onchange = (e) => { onlyMissing = e.target.checked; shown = 40; draw(); };
  draw();
  return () => {};
}
