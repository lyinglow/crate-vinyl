// A person: who they are, who they work with in your collection, what of theirs you own, and more of theirs on Discogs.
import { state, saveRecord } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { kick, removeWanted } from '../sync.js';
import { listenTo, markHeard, heardMap } from '../listen.js';
import { esc, cover, icon, circle, toast, hydratePhotos, describeError, $ } from '../ui.js';

const clean = (t) => String(t || '')
  .replace(/\[a=?([^\]]+)\]/g, '$1').replace(/\[l=?([^\]]+)\]/g, '$1').replace(/\[m=?\d+\]/g, '').replace(/\[r=?\d+\]/g, '')
  .replace(/\[url=[^\]]*\]([^\[]*)\[\/url\]/g, '$1').replace(/\[\/?[a-z]\]/g, '').replace(/\s+/g, ' ').trim();

// What your own records say about this person.
export function inCollection(id) {
  const out = [];
  for (const r of state.records.values()) {
    if (r.wanted) continue;
    const c = (r.credits || []).find((x) => String(x.id) === String(id));
    if (c) out.push({ rec: r, roles: c.roles });
  }
  return out.sort((a, b) => M.norm(a.rec.title).localeCompare(M.norm(b.rec.title)));
}

// Other people credited on the same records, the most shared first.
export function workedWith(id) {
  const by = new Map();
  for (const { rec } of inCollection(id)) {
    for (const c of rec.credits || []) {
      if (String(c.id) === String(id)) continue;
      const e = by.get(c.id) || { id: c.id, name: c.name, n: 0, roles: new Map() };
      e.n++;
      for (const ro of c.roles) e.roles.set(ro, (e.roles.get(ro) || 0) + 1);
      by.set(c.id, e);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 16)
    .map((e) => ({ id: e.id, name: e.name, n: e.n, role: [...e.roles.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
}

export function mount(root, args) {
  const id = args[0];
  const name = decodeURIComponent(args[1] || '') || 'This person';
  root.innerHTML = `
    <div class="page person">
      <a class="back" href="#/library" id="p-back">${icon('back', 20)} Back</a>
      <div class="phead"><span class="av big" style="--h:${esc(String(hueOf(name)))}">${esc(name.charAt(0).toUpperCase())}</span><div><h1>${esc(name)}</h1><p class="sub" id="p-sub"></p></div></div>
      <p class="profile" id="p-profile"></p>
      <div id="p-links"></div>
      <div id="p-with"></div>
      <div id="p-mine"></div>
      <div id="p-more"></div>
    </div>`;
  $('#p-back', root).onclick = (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } };

  const mine = inCollection(id);
  $('#p-sub', root).textContent = mine.length ? `On ${mine.length} record${mine.length === 1 ? '' : 's'} you own` : '';

  function drawMine() {
    const w = workedWith(id);
    $('#p-with', root).innerHTML = w.length ? `<h3 class="sec">Worked with, on your records</h3><div class="circles">${w.map((x) => circle({ id: x.id, name: x.name, sub: `${x.role} · ${x.n} record${x.n === 1 ? '' : 's'}` })).join('')}</div>` : '';
    $('#p-mine', root).innerHTML = mine.length ? `<h3 class="sec">On your records</h3><div class="rows">${mine.map(({ rec, roles }) => `
      <a class="lrow" href="#/record/${esc(rec.id)}"><div class="lthumb">${cover(rec, { small: true })}</div>
        <div class="ltext"><b>${esc(rec.artist)}</b><span>${esc(rec.title)}</span><small>${esc([rec.year, roles.join(', ')].filter(Boolean).join(' · '))}</small></div></a>`).join('')}</div>` : '';
    hydratePhotos($('#p-mine', root));
  }
  drawMine();

  // Who they are, from Discogs.
  (async () => {
    try {
      const a = await D.artist(id);
      if (!root.isConnected) return;
      if (a.profile) $('#p-profile', root).textContent = clean(a.profile).slice(0, 320) + (clean(a.profile).length > 320 ? '...' : '');
      const groups = [];
      const add = (title, list, sub) => { if (list && list.length) groups.push(`<h3 class="sec">${esc(title)}</h3><div class="circles">${list.slice(0, 24).map((x) => circle({ id: x.id, name: String(x.name).replace(/\s*\(\d+\)$/, ''), sub })).join('')}</div>`); };
      add('Members', a.members, 'Member');
      add('In these groups', a.groups, 'Group');
      add('Also known as', a.aliases, 'Alias');
      $('#p-links', root).innerHTML = groups.join('');
    } catch { /* the page still works from your own records */ }
  })();

  // More of theirs on Discogs.
  let items = [];
  let filter = 'all';
  let shown = 30;
  const owned = () => {
    const o = new Set();
    for (const r of state.records.values()) if (!r.wanted) { if (r.releaseId) o.add(`r${r.releaseId}`); if (r.masterId) o.add(`m${r.masterId}`); }
    return o;
  };
  const wantedSet = () => {
    const o = new Set();
    for (const r of state.records.values()) if (r.wanted && r.releaseId) o.add(`r${r.releaseId}`);
    return o;
  };

  function drawMore() {
    const el = $('#p-more', root);
    if (!items.length) return;
    const ow = owned();
    const wn = wantedSet();
    const hd = heardMap();
    const list = items
      .filter((x) => !(ow.has(`r${x.rid}`) || (x.type === 'master' && ow.has(`m${x.id}`))))
      .filter((x) => filter === 'all' || (filter === 'main' ? x.role === 'Main' : x.role !== 'Main'));
    el.innerHTML = `<h3 class="sec">More on Discogs</h3>
      <div class="chips" id="p-f">${[['all', 'All'], ['main', 'Their own records'], ['credit', 'Credited on']].map(([k, l]) => `<button type="button" class="chip${k === filter ? ' on' : ''}" data-f="${k}">${l}</button>`).join('')}</div>
      ${list.length ? `<div class="rows">${list.slice(0, shown).map((x) => `<div class="drow" data-k="${esc(x.key)}">
        <div class="wthumb">${cover({ artist: x.artist, title: x.title, thumb: x.thumb, cover: x.thumb }, { small: true })}</div>
        <div class="wtext"><b>${esc(x.title)}</b><span>${esc(x.artist)}</span><span>${esc([x.year, x.label, x.role !== 'Main' ? x.role : ''].filter(Boolean).join(' · '))}</span>
          <div class="drow-btns"><button class="btn small" data-listen="${esc(x.key)}">${icon('play', 14)} ${hd[`r${x.rid}`] ? 'Listen again' : 'Listen'}</button>${wn.has(`r${x.rid}`) ? '<span class="tag">On your wanted list</span>' : `<button class="btn small primary" data-want="${esc(x.key)}">Want it</button>`}<a class="btn small" href="https://www.discogs.com/${x.type === 'master' ? 'master' : 'release'}/${x.id}" target="_blank" rel="noopener">Discogs ${icon('external', 13)}</a></div></div></div>`).join('')}</div>${list.length > shown ? `<button class="btn small" id="p-more-btn">Show more (${list.length - shown} left)</button>` : ''}` : '<p class="muted">Nothing more that you do not already have.</p>'}`;
    hydratePhotos(el);
  }

  (async () => {
    try {
      const res = await D.artistReleases(id);
      items = (res.releases || []).map((x) => ({ key: `${x.type}${x.id}`, id: x.id, rid: x.type === 'master' ? x.main_release : x.id, type: x.type, title: x.title, artist: String(x.artist || name).replace(/\s*\(\d+\)$/, ''), year: x.year || '', label: x.label || '', role: x.role || 'Main', thumb: x.thumb || '', format: x.format || '' }))
        .filter((x) => x.rid);
      if (root.isConnected) drawMore();
    } catch (e) {
      if (root.isConnected) $('#p-more', root).innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
    }
  })();

  root.addEventListener('click', async (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { filter = f.dataset.f; shown = 30; drawMore(); return; }
    if (e.target.closest('#p-more-btn')) { shown += 30; drawMore(); return; }
    const l = e.target.closest('[data-listen]');
    if (l) {
      const x = items.find((i) => i.key === l.dataset.listen);
      if (!x) return;
      listenTo({ artist: x.artist, title: x.title, releaseId: x.rid });
      await markHeard(`r${x.rid}`);
      drawMore();
      return;
    }
    const w = e.target.closest('[data-want]');
    if (!w) return;
    const x = items.find((i) => i.key === w.dataset.want);
    if (!x) return;
    const rec = M.newRecord({ source: 'discogs', releaseId: x.rid, masterId: x.type === 'master' ? x.id : null, artist: x.artist, title: x.title, label: x.label, year: Number(x.year) || null, thumb: x.thumb, cover: x.thumb, formatTags: ['Vinyl'], formatText: x.format }, { wanted: true, wantDetail: true });
    await saveRecord(rec);
    kick();
    drawMore();
    toast(`${rec.title} is on your wanted list`, { action: 'Undo', onAction: async () => { await removeWanted(rec); drawMore(); } });
  });

  return () => {};
}

function hueOf(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}
