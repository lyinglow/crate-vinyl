// Collection stats: how the collection splits by decade, year, label and value.
import { state } from '../store.js';
import * as M from '../model.js';
import { esc, icon, $ } from '../ui.js';
import { filterState as F } from './library.js';

const BANDS = [[0, 5, 'Under £5'], [5, 10, '£5 to £10'], [10, 25, '£10 to £25'], [25, 50, '£25 to £50'], [50, 100, '£50 to £100'], [100, Infinity, '£100 and over']];

function add(map, key, value) {
  const g = map.get(key) || { key, count: 0, value: 0, priced: 0 };
  g.count++;
  if (value != null) { g.value += value; g.priced++; }
  map.set(key, g);
}

// Pure, so it can be tested: records in, groups out. Sold records are left out.
export function collectionStats(records) {
  const owned = [...records].filter((r) => r.status !== 'sold' && !r.wanted);
  const decades = new Map();
  const years = new Map();
  const labels = new Map();
  const bands = new Map(BANDS.map(([, , n]) => [n, { key: n, count: 0, value: 0, priced: 0 }]));
  const unpriced = { key: 'Not priced yet', count: 0, value: 0, priced: 0 };
  let total = 0;
  for (const r of owned) {
    const v = M.estimate(r);
    if (v != null) total += v;
    const y = Number(r.year) || 0;
    add(decades, y ? `${Math.floor(y / 10) * 10}s` : 'Year unknown', v);
    add(years, y || 'Year unknown', v);
    add(labels, (r.label || '').trim() || 'Label unknown', v);
    if (v == null) unpriced.count++;
    else {
      const b = BANDS.find(([lo, hi]) => v >= lo && v < hi);
      const g = bands.get(b[2]);
      g.count++; g.value += v; g.priced++;
    }
  }
  const byKey = (a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true });
  return {
    count: owned.length,
    total,
    decades: [...decades.values()].sort(byKey),
    years: [...years.values()].sort(byKey),
    labels: [...labels.values()].sort((a, b) => b.count - a.count || b.value - a.value || byKey(a, b)),
    bands: [...bands.values(), unpriced].filter((g) => g.count),
  };
}

let metric = 'count';
let decade = '';
let labelsShown = 12;

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/value">${icon('back', 20)} Value</a>
      <div class="largetitle"><h1>Collection stats</h1><p class="sub" id="st-sub"></p></div>
      <div id="st-body"></div>
    </div>`;

  function rows(groups, { pick, active, max }) {
    const top = Math.max(1, ...groups.map((g) => (metric === 'value' ? g.value : g.count)));
    const cur = state.settings.currency;
    return `<div class="stat-rows">${groups.map((g) => {
      const n = metric === 'value' ? g.value : g.count;
      const pct = Math.max(2, Math.round((n / (max || top)) * 100));
      return `<button type="button" class="srow${active === String(g.key) ? ' on' : ''}" data-k="${esc(String(g.key))}" ${pick ? '' : 'tabindex="-1"'}>
        <span class="sn">${esc(String(g.key))}</span>
        <span class="sbar"><i style="width:${pct}%"></i></span>
        <span class="sv"><b>${metric === 'value' ? esc(M.money(g.value, cur, 0)) : g.count.toLocaleString('en-GB')}</b><em>${metric === 'value' ? `${g.count.toLocaleString('en-GB')} record${g.count === 1 ? '' : 's'}` : (g.priced ? esc(M.money(g.value, cur, 0)) : '')}</em></span>
      </button>`;
    }).join('')}</div>`;
  }

  function draw() {
    const S = collectionStats(state.records.values());
    const cur = state.settings.currency;
    $('#st-sub', root).textContent = S.count ? `${S.count.toLocaleString('en-GB')} records · ${M.money(S.total, cur, 0)}` : '';
    if (!S.count) { $('#st-body', root).innerHTML = '<div class="empty small"><p>Add some records and their stats show here.</p></div>'; return; }
    if (!S.decades.some((d) => String(d.key) === decade)) {
      decade = String([...S.decades].sort((a, b) => b.count - a.count)[0].key);
    }
    const yrs = S.years.filter((y) => y.key !== 'Year unknown' && `${Math.floor(Number(y.key) / 10) * 10}s` === decade);
    $('#st-body', root).innerHTML = `
      <div class="chips" id="st-metric">${[['count', 'Records'], ['value', 'Value']].map(([k, l]) => `<button type="button" class="chip${metric === k ? ' on' : ''}" data-m="${k}">${l}</button>`).join('')}</div>
      <h3 class="sec">By decade</h3>
      <div id="st-dec">${rows(S.decades, { pick: true, active: decade })}</div>
      ${yrs.length ? `<h3 class="sec">Years in the ${esc(decade)}</h3><p class="muted">Tap a year to see those records.</p><div id="st-yr">${rows(yrs, { pick: true })}</div>` : ''}
      <h3 class="sec">Labels</h3>
      <p class="muted">Tap a label to see its records.</p>
      <div id="st-lab">${rows(S.labels.slice(0, labelsShown), { pick: true, max: Math.max(1, ...S.labels.slice(0, labelsShown).map((g) => (metric === 'value' ? g.value : g.count))) })}</div>
      ${S.labels.length > labelsShown ? `<button class="btn small" id="st-more">Show all ${S.labels.length.toLocaleString('en-GB')} labels</button>` : ''}
      <h3 class="sec">By value</h3>
      <div id="st-val">${rows(S.bands, {})}</div>`;
  }

  function browse(patch) {
    Object.assign(F, { q: '', status: 'all', loved: false, genre: '', style: '', format: '', label: '', artist: '', from: '', to: '', sort: 'added', count: 120, scroll: 0 }, patch);
    location.hash = '#/browse';
  }

  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { metric = m.dataset.m; draw(); return; }
    if (e.target.closest('#st-more')) { labelsShown = 9999; draw(); return; }
    const r = e.target.closest('.srow');
    if (!r) return;
    const k = r.dataset.k;
    if (r.closest('#st-dec')) { if (k !== 'Year unknown') { decade = k; draw(); } return; }
    if (r.closest('#st-yr')) return browse({ from: k, to: k });
    if (r.closest('#st-lab')) { if (k !== 'Label unknown') browse({ label: k }); }
  });

  draw();
  return () => {};
}
