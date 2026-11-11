// The library: sleeves in a grid, or a list. Search, filter, sort.
import { state, saveSettings, subscribe } from '../store.js';
import * as M from '../model.js';
import { esc, cover, icon, openSheet, debounce, hydratePhotos, toast, $ } from '../ui.js';
import { exportBackup } from '../exporter.js';
import { lovedCount } from './loved.js';

// Kept while the app is open, so coming back from a record keeps your place.
const v = { q: '', status: 'all', loved: false, genre: '', style: '', format: '', label: '', artist: '', from: '', to: '', sort: 'added', count: 120, scroll: 0 };
const STEP = 120;

export const filterState = v;
export const filtersOn = () => !!(v.loved || v.genre || v.style || v.format || v.label || v.artist || v.from || v.to);

export function mount(root) {
  const s = state.settings;
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/library">${icon('back', 20)} Cover flow</a>
      <div class="largetitle"><h1>Browse</h1><p class="sub" id="lib-count"></p></div>
      <div class="shortcuts">
        <a class="short" href="#/mixes">${icon('list', 20)}<span>Mixes</span><em id="n-mixes"></em></a>
        <a class="short" href="#/loved">${icon('heart', 20)}<span>Loved tracks</span><em id="n-loved"></em></a>
        <a class="short" href="#/wanted">${icon('bookmark', 20)}<span>Wanted</span><em id="n-wanted"></em></a>
        <a class="short" href="#/dig">${icon('search', 20)}<span>Dig</span><em></em></a>
      </div>
      <div id="lib-banner"></div>
      <div class="toolbar">
        <label class="search">${icon('search', 18)}<input id="q" type="search" placeholder="Search your records" autocomplete="off" autocapitalize="off" enterkeyhint="search" value="${esc(v.q)}"></label>
        <button class="icon-btn" id="btn-view" aria-label="Switch between grid and list"></button>
        <button class="icon-btn" id="btn-filter" aria-label="Filters">${icon('filter', 22)}<i class="dot" id="filter-dot" hidden></i></button>
      </div>
      <div class="chips scroll" id="status-chips">
        ${[['all', 'All'], ['keeping', 'Keeping'], ['for_sale', 'For sale'], ['sold', 'Sold']].map(([k, l]) => `<button class="chip${v.status === k ? ' on' : ''}" data-status="${k}">${l}</button>`).join('')}
      </div>
      <div id="lib-body"></div>
    </div>`;

  const body = $('#lib-body', root);
  let list = [];
  let observer = null;

  function banner() {
    const el = $('#lib-banner', root);
    const st = state.settings;
    const n = [...state.records.values()].filter((r) => !r.wanted).length;
    if (!st.token) {
      el.innerHTML = `<a class="banner" href="#/welcome">Connect your Discogs account to start. <b>Connect</b></a>`;
    } else if (n >= 20 && Date.now() - st.lastBackup > 14 * 864e5) {
      el.innerHTML = `<div class="banner">Last backup: ${esc(M.ago(st.lastBackup))}. <button class="link" id="bk">Back up now</button></div>`;
      $('#bk', el).onclick = async () => {
        try { const r = await exportBackup(); if (r !== 'cancelled') { toast('Backup saved'); banner(); } } catch (e) { toast(e.message); }
      };
    } else {
      el.innerHTML = '';
    }
  }

  function item(r) {
    const badge = r.status === 'for_sale' ? 'For sale' : r.status === 'sold' ? 'Sold' : '';
    if (state.settings.view === 'list') {
      const val = M.estimate(r);
      const cur = (r.market && r.market.currency) || state.settings.currency;
      return `<a class="lrow" href="#/record/${r.id}">
        <div class="lthumb">${cover(r, { small: true })}</div>
        <div class="ltext"><b>${esc(r.artist || 'Unknown artist')}</b><span>${esc(r.title)}</span><small>${esc([r.year, r.label, M.formatShort(r)].filter(Boolean).join(' · '))}</small></div>
        <div class="lright">${val != null ? `<b>${esc(M.money(val, cur))}</b>` : ''}<small>${esc([r.mediaGrade, badge].filter(Boolean).join(' · '))}</small></div>
      </a>`;
    }
    return `<a class="item" href="#/record/${r.id}">${cover(r, { badge })}<div class="cap"><b>${esc(r.artist || 'Unknown artist')}</b><span>${esc(r.title)}</span></div></a>`;
  }

  function chunk(from, to) {
    const html = list.slice(from, to).map(item).join('');
    const holder = body.querySelector('#items');
    holder.insertAdjacentHTML('beforeend', html);
    hydratePhotos(holder);
  }

  function draw() {
    banner();
    const all = [...state.records.values()].filter((r) => !r.wanted);
    list = M.sortRecords(M.filterRecords(all, v), v.sort);
    const n = all.length;
    $('#lib-count', root).textContent = n === 0 ? '' : list.length === n ? `${n.toLocaleString('en-GB')} record${n === 1 ? '' : 's'}` : `${list.length.toLocaleString('en-GB')} of ${n.toLocaleString('en-GB')}`;
    $('#n-mixes', root).textContent = state.mixes.length || '';
    $('#n-loved', root).textContent = lovedCount() || '';
    $('#n-wanted', root).textContent = [...state.records.values()].filter((r) => r.wanted).length || '';
    $('#btn-view', root).innerHTML = icon(state.settings.view === 'list' ? 'grid' : 'list', 22);
    $('#filter-dot', root).hidden = !filtersOn() && v.sort === 'added';
    if (observer) observer.disconnect();

    if (n === 0) {
      body.innerHTML = `<div class="empty">
        <div class="disc"></div>
        <h2>Your library is empty</h2>
        <p>Scan a barcode to add your first record.</p>
        <a class="btn primary" href="#/scan">Start scanning</a>
        ${state.settings.token ? `<a class="btn" href="#/settings">Import my Discogs collection</a>` : ''}
      </div>`;
      return;
    }
    if (!list.length) {
      body.innerHTML = `<div class="empty small"><p>Nothing matches. Try fewer filters.</p><button class="btn small" id="clear">Clear filters</button></div>`;
      $('#clear', body).onclick = () => { clearFilters(); draw(); };
      return;
    }
    const cls = state.settings.view === 'list' ? 'list' : 'grid';
    body.innerHTML = `<div id="items" class="${cls}" style="--min:${[0, 0, 150, 104, 78][state.settings.size] || 104}px"></div><div id="sentinel" style="height:1px"></div>`;
    const shown = Math.min(v.count, list.length);
    chunk(0, shown);
    if (shown < list.length) {
      observer = new IntersectionObserver((ents) => {
        if (!ents[0].isIntersecting) return;
        const from = Math.min(v.count, list.length);
        v.count = from + STEP;
        const to = Math.min(v.count, list.length);
        chunk(from, to);
        if (to >= list.length) observer.disconnect();
      }, { rootMargin: '900px' });
      observer.observe(body.querySelector('#sentinel'));
    }
  }

  function clearFilters() {
    Object.assign(v, { loved: false, genre: '', style: '', format: '', label: '', artist: '', from: '', to: '', sort: 'added', count: STEP });
  }

  // ---- events ----
  $('#q', root).addEventListener('input', debounce((e) => { v.q = e.target.value; v.count = STEP; draw(); }, 160));
  $('#status-chips', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]');
    if (!b) return;
    v.status = b.dataset.status;
    v.count = STEP;
    root.querySelectorAll('#status-chips .chip').forEach((c) => c.classList.toggle('on', c === b));
    draw();
  });
  $('#btn-view', root).onclick = async () => { await saveSettings({ view: state.settings.view === 'list' ? 'grid' : 'list' }); v.count = STEP; draw(); };
  $('#btn-filter', root).onclick = () => filterSheet(() => { v.count = STEP; draw(); });

  draw();
  if (v.scroll) requestAnimationFrame(() => window.scrollTo(0, v.scroll));

  let redraw = null;
  const off = subscribe((kind) => {
    if (kind !== 'records') return;
    clearTimeout(redraw);
    redraw = setTimeout(draw, 250);
  });

  return () => {
    v.scroll = window.scrollY;
    clearTimeout(redraw);
    off();
    if (observer) observer.disconnect();
  };
}

function filterSheet(onApply) {
  const f = M.facets([...state.records.values()].filter((r) => !r.wanted));
  const sel = (name, opts, cur, any) => `<select name="${name}"><option value="">${any}</option>${opts.map((o) => `<option${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const sizes = [[2, 'Large'], [3, 'Medium'], [4, 'Small']];
  const s = openSheet({
    title: 'Filter and sort',
    body: `<form class="form" id="ff">
      <label class="field"><span>Sort by</span><select name="sort">${[['added', 'Recently added'], ['artist', 'Artist A to Z'], ['title', 'Title A to Z'], ['year', 'Year, oldest first'], ['value', 'Value, highest first']].map(([k, l]) => `<option value="${k}"${v.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="loved"${v.loved ? ' checked' : ''}> Only records with a loved track</label>
      <label class="field"><span>Artist</span><input name="artist" value="${esc(v.artist)}" autocomplete="off"></label>
      <label class="field"><span>Label</span><input name="label" value="${esc(v.label)}" autocomplete="off"></label>
      <div class="two">
        <label class="field"><span>Genre</span>${sel('genre', f.genres, v.genre, 'Any')}</label>
        <label class="field"><span>Style</span>${sel('style', f.styles, v.style, 'Any')}</label>
      </div>
      <label class="field"><span>Format</span>${sel('format', f.formats, v.format, 'Any')}</label>
      <div class="two">
        <label class="field"><span>Year from</span><input name="from" inputmode="numeric" maxlength="4" value="${esc(v.from)}"></label>
        <label class="field"><span>Year to</span><input name="to" inputmode="numeric" maxlength="4" value="${esc(v.to)}"></label>
      </div>
      <div class="field"><span>Sleeve size</span><div class="chips" id="sizes">${sizes.map(([n, l]) => `<button type="button" class="chip${state.settings.size === n ? ' on' : ''}" data-n="${n}">${l}</button>`).join('')}</div></div>
      <div class="stack"><button class="btn primary" type="submit">Show records</button><button class="btn ghost" type="button" id="clear">Clear all</button></div>
    </form>`,
  });
  const form = s.el.querySelector('#ff');
  s.el.querySelector('#sizes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-n]');
    if (!b) return;
    s.el.querySelectorAll('#sizes .chip').forEach((c) => c.classList.toggle('on', c === b));
    saveSettings({ size: Number(b.dataset.n) });
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    for (const k of ['sort', 'artist', 'label', 'genre', 'style', 'format', 'from', 'to']) v[k] = String(fd.get(k) || '').trim();
    v.loved = fd.get('loved') === 'on';
    v.sort = v.sort || 'added';
    s.close();
    onApply();
  };
  s.el.querySelector('#clear').onclick = () => {
    Object.assign(v, { loved: false, genre: '', style: '', format: '', label: '', artist: '', from: '', to: '', sort: 'added' });
    s.close();
    onApply();
  };
}
