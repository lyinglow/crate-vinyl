// Dig: records you do not own that collectors pushed up the list in a given decade and style.
// Discogs says how many people own and want each pressing, so that is the measure of "big at the time".
import { state, saveRecord, saveSettings } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { esc, cover, icon, toast, openSheet, hydratePhotos, describeError, $ } from '../ui.js';
import { kick, removeWanted } from '../sync.js';

const DECADES = [1960, 1970, 1980, 1990, 2000, 2010, 2020];
// The kinds of house music, as Discogs names its styles. Tap one to dig it. Discogs only matches a style by its
// exact name, so if one is spelled differently there, Crate falls back to searching for the words.
const HOUSE = ['House', 'Deep House', 'Tech House', 'Progressive House', 'Acid House', 'Garage House', 'Hard House', 'Italo House', 'Tribal House', 'Electro House', 'Euro House', 'Ghetto House', 'Hip House', 'Chicago House', 'Disco House'];
const SORTS = [['have', 'Most owned'], ['want', 'Most wanted'], ['seek', 'Sought after']];

// Kept while the app is open, so you can leave to listen and come back to the same list.
const dig = { loose: false, hideHeard: false, view: 'results', decade: 0, style: '', sort: 'have', vinyl: true, found: new Map(), pages: 0, scanned: 0, busy: false, error: '', shown: 40, ran: false };

// What you own or already want. A pressing counts as owned if its master is.
function mine() {
  const owned = new Set();
  const wanted = new Set();
  for (const r of state.records.values()) {
    const set = r.wanted ? wanted : owned;
    if (r.releaseId) set.add(`r${r.releaseId}`);
    if (r.masterId) set.add(`m${r.masterId}`);
  }
  return { owned, wanted };
}

// Records you said you are not interested in. Kept on this phone so they stay hidden next time,
// and so you can bring them back. Each keeps what is needed to show it again.
const passedList = () => (Array.isArray(state.settings.digPassed) ? state.settings.digPassed : []);
const slim = (c) => ({ releaseId: c.releaseId, masterId: c.masterId, artist: c.artist, title: c.title, label: c.label, catno: c.catno, year: c.year, country: c.country, thumb: c.thumb, cover: c.cover, formatTags: c.formatTags, formatText: c.formatText, genres: c.genres, styles: c.styles, community: c.community, source: 'discogs' });

// Records whose Listen you have opened, with when. Saved on this phone.
const heardMap = () => (state.settings.digHeard && typeof state.settings.digHeard === 'object' ? state.settings.digHeard : {});

export function rank(list, sort) {
  const have = (e) => (e.c.community && e.c.community.have) || 0;
  const want = (e) => (e.c.community && e.c.community.want) || 0;
  // Sought after: many want it for each one that owns it. A small floor keeps one-off oddities out.
  if (sort === 'seek') return list.filter((e) => have(e) >= 20).sort((a, b) => want(b) / Math.max(1, have(b)) - want(a) / Math.max(1, have(a)));
  const out = list.slice();
  if (sort === 'want') out.sort((a, b) => want(b) - want(a) || have(b) - have(a));
  else out.sort((a, b) => have(b) - have(a) || want(b) - want(a));
  return out;
}

// One pressing per master, the most owned one, so a title is not listed ten times.
function take(results) {
  for (const r of results) {
    const c = M.fromSearch(r);
    if (!c.releaseId || (dig.vinyl && !c.formatTags.includes('Vinyl'))) continue;
    const key = c.masterId ? `m${c.masterId}` : `r${c.releaseId}`;
    const have = (c.community && c.community.have) || 0;
    const cur = dig.found.get(key);
    if (!cur) dig.found.set(key, { key, c, pressings: 1 });
    else {
      cur.pressings++;
      if (have > ((cur.c.community && cur.c.community.have) || 0)) cur.c = c;
    }
  }
}

export function mount(root) {
  if (!dig.decade) {
    // Start on the decade you own the most from.
    const by = new Map();
    for (const r of state.records.values()) if (!r.wanted && r.year) by.set(Math.floor(r.year / 10) * 10, (by.get(Math.floor(r.year / 10) * 10) || 0) + 1);
    dig.decade = [...by.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]).find((d) => DECADES.includes(d)) || 1990;
  }
  const f = M.facets([...state.records.values()].filter((r) => !r.wanted));
  if (!dig.style && f.styles.length) dig.style = f.styles[0];

  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/wanted">${icon('back', 20)} Wanted</a>
      <div class="largetitle"><h1>Dig</h1><p class="sub">Records you do not own that collectors rate from a decade you choose</p></div>
      <div class="chips" id="d-decades">${DECADES.map((d) => `<button type="button" class="chip${d === dig.decade ? ' on' : ''}" data-d="${d}">${d}s</button>`).join('')}</div>
      <div class="field"><span>House types</span><div class="chips" id="d-house">${HOUSE.map((h) => `<button type="button" class="chip${h === dig.style ? ' on' : ''}" data-h="${esc(h)}">${esc(h)}</button>`).join('')}</div></div>
      <label class="field"><span>Style</span><input id="d-style" list="d-styles" value="${esc(dig.style)}" placeholder="For example House, Garage, Jungle" autocomplete="off" autocapitalize="words"></label>
      <datalist id="d-styles">${f.styles.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <label class="check"><input type="checkbox" id="d-vinyl"${dig.vinyl ? ' checked' : ''}> Vinyl only</label>
      <div class="row-btns"><button class="btn primary" id="d-go">Find records</button></div>
      <div class="chips" id="d-sorts">${SORTS.map(([k, l]) => `<button type="button" class="chip${k === dig.sort ? ' on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="d-hideheard"${dig.hideHeard ? ' checked' : ''}> Hide the ones I have heard</label>
      <div class="seg" id="d-view"><button type="button" data-v="results" class="on">Results</button><button type="button" data-v="passed">Not interested <em id="d-npass"></em></button></div>
      <p class="hint-text" id="d-note"></p>
      <div id="d-list"></div>
    </div>`;

  let token = 0;

  function row(e, kind) {
    const c = e.c;
    const { wanted } = mine();
    const w = wanted.has(e.key) || wanted.has(`r${c.releaseId}`);
    const cm = c.community || {};
    const btns = kind === 'passed'
      ? `<button class="btn small" data-back="${esc(e.key)}">Bring back</button>`
      : `<button class="btn small" data-pass="${esc(e.key)}">Not interested</button>`;
    const heard = heardMap()[e.key] || heardMap()[`r${c.releaseId}`];
    return `<div class="drow${heard ? ' heard' : ''}" data-k="${esc(e.key)}">
      <div class="wthumb">${cover(c, { small: true })}</div>
      <div class="wtext">
        ${heard ? `<span class="heardtag">${icon('check', 14)} Heard ${esc(M.ago(heard))}</span>` : ''}
        <b>${esc(c.artist || 'Unknown artist')}</b><span>${esc(c.title)}</span>
        <span>${esc([c.label, c.catno, c.year, c.country].filter(Boolean).join(' · '))}</span>
        <span class="wprice">${cm.have != null ? `${cm.have.toLocaleString('en-GB')} own it · ${(cm.want || 0).toLocaleString('en-GB')} want it` : 'No collector numbers'}</span>
        <div class="drow-btns"><button class="btn small" data-listen="${esc(e.key)}">${icon('play', 14)} ${heard ? 'Listen again' : 'Listen'}</button>${w ? '<span class="tag">On your wanted list</span>' : `<button class="btn small primary" data-want="${esc(e.key)}">Want it</button>`}${btns}</div>
      </div>
    </div>`;
  }

  function drawList() {
    const { owned } = mine();
    const passed = passedList();
    const passedKeys = new Set(passed.map((p) => p.k));
    $('#d-npass', root).textContent = passed.length ? `(${passed.length})` : '';
    root.querySelectorAll('#d-view button').forEach((b) => b.classList.toggle('on', b.dataset.v === dig.view));
    const el = $('#d-list', root);
    if (dig.view === 'passed') {
      $('#d-note', root).textContent = passed.length ? 'Records you passed on while digging. Bring one back any time.' : '';
      const items = passed.map((p) => ({ key: p.k, c: p.c })).sort((a, b) => String(a.c.artist).localeCompare(String(b.c.artist)));
      el.innerHTML = items.length ? items.map((e) => row(e, 'passed')).join('') : '<div class="empty small"><p>Nothing here.</p><p class="muted">Tap Not interested on a record while digging and it waits here.</p></div>';
      hydratePhotos(el);
      return;
    }
    const heardNow = heardMap();
    const isHeard = (e) => !!(heardNow[e.key] || heardNow[`r${e.c.releaseId}`]);
    const all = [...dig.found.values()].filter((e) => !owned.has(e.key) && !owned.has(`r${e.c.releaseId}`) && !passedKeys.has(e.key) && !(dig.hideHeard && isHeard(e)));
    const list = rank(all, dig.sort);
    const hidden = [...dig.found.values()].filter((e) => owned.has(e.key) || owned.has(`r${e.c.releaseId}`)).length;
    const skipped = [...dig.found.values()].filter((e) => passedKeys.has(e.key)).length;
    $('#d-note', root).textContent = dig.error
      || (dig.ran && !dig.busy && dig.loose && !dig.scanned ? `Nothing found for "${dig.style}". Try House, or a different decade.`
      : dig.loose && dig.scanned ? `Discogs has no style called "${dig.style}", so Crate searched for those words in Electronic records instead. ${dig.scanned.toLocaleString('en-GB')} pressings looked at.`
      : dig.busy ? `Looking through ${dig.decade}s pressings. ${dig.scanned.toLocaleString('en-GB')} so far...`
        : dig.ran ? `${dig.scanned.toLocaleString('en-GB')} pressings looked at. ${list.length.toLocaleString('en-GB')} records you do not own${hidden ? `, and ${hidden.toLocaleString('en-GB')} you do` : ''}${skipped ? `. ${skipped.toLocaleString('en-GB')} set aside as not interested` : ''}. Owned and wanted counts are Discogs members, not everyone.` : '');
    if (!list.length) {
      el.innerHTML = dig.ran && !dig.busy ? '<div class="empty small"><p>Nothing found. Try another style, or a different decade.</p></div>' : '';
      return;
    }
    el.innerHTML = list.slice(0, dig.shown).map((e) => row(e, 'results')).join('') + (list.length > dig.shown ? '<button class="btn small" id="d-more">Show more</button>' : '');
    hydratePhotos(el);
  }

  async function run() {
    const mine1 = ++token;
    dig.found = new Map(); dig.scanned = 0; dig.error = ''; dig.busy = true; dig.ran = true; dig.shown = 40; dig.loose = false;
    dig.style = $('#d-style', root).value.trim();
    dig.vinyl = $('#d-vinyl', root).checked;
    if (!dig.style) { dig.busy = false; dig.ran = false; toast('Choose a style first.'); return; }
    drawList();
    try {
      const years = Array.from({ length: 10 }, (_, k) => dig.decade + k);
      const pass = async (extra) => {
        for (const y of years) {
          if (mine1 !== token) return false;
          const res = await D.search({ type: 'release', year: String(y), ...extra, ...(dig.vinyl ? { format: 'Vinyl' } : {}) }, 1, 100);
          const rows = res.results || [];
          dig.scanned += rows.length;
          take(rows);
          drawList();
        }
        return true;
      };
      if (!(await pass({ style: dig.style }))) return;
      if (!dig.scanned && mine1 === token) {
        // Discogs has no style by that exact name. Look for the words instead.
        dig.loose = true;
        drawList();
        await pass({ q: dig.style, genre: 'Electronic' });
      }
    } catch (e) {
      dig.error = describeError(e);
    } finally {
      if (mine1 === token) { dig.busy = false; drawList(); }
    }
  }

  function entryFor(key) {
    const hit = dig.found.get(key);
    if (hit) return hit;
    const p = passedList().find((x) => x.k === key);
    return p ? { key, c: p.c } : null;
  }

  async function listen(entry) {
    const s = openSheet({ title: 'Listen', body: `<p class="muted"><b>${esc(entry.c.artist)}</b><br>${esc(entry.c.title)}</p><div id="d-vids"><p class="muted">Looking for videos...</p></div>` });
    try {
      const rel = await D.release(entry.c.releaseId, 0);
      const vids = M.uniqueVideos((rel.videos || []).map((v) => ({ id: M.youtubeId(v.uri), title: v.title || '', duration: v.duration || 0 })).filter((v) => v.id)).slice(0, 12);
      const box = s.el.querySelector('#d-vids');
      if (!vids.length) { box.innerHTML = '<p class="muted">Discogs has no videos for this release.</p>'; return; }
      const player = (id) => `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&autoplay=1" title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
      box.innerHTML = `<div id="d-player">${player(vids[0].id)}</div><div class="rows">${vids.map((v, i) => `<button class="play-row${i ? '' : ' on'}" data-play="${esc(v.id)}"><span class="pi">${icon('play', 18)}</span><span class="pt">${esc(v.title)}</span><span class="pd">${esc(M.clock(v.duration))}</span></button>`).join('')}</div>`;
      box.onclick = (e) => {
        const b = e.target.closest('[data-play]');
        if (!b) return;
        box.querySelectorAll('.play-row').forEach((r) => r.classList.toggle('on', r === b));
        box.querySelector('#d-player').innerHTML = player(b.dataset.play);
      };
    } catch (e) {
      s.el.querySelector('#d-vids').innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
    }
  }

  root.addEventListener('click', async (e) => {
    const hs = e.target.closest('[data-h]');
    if (hs) {
      $('#d-style', root).value = hs.dataset.h;
      root.querySelectorAll('#d-house .chip').forEach((c) => c.classList.toggle('on', c === hs));
      dig.view = 'results';
      run();
      return;
    }
    const d = e.target.closest('[data-d]');
    if (d) { dig.decade = Number(d.dataset.d); root.querySelectorAll('#d-decades .chip').forEach((c) => c.classList.toggle('on', c === d)); return; }
    const sc = e.target.closest('[data-s]');
    if (sc) { dig.sort = sc.dataset.s; root.querySelectorAll('#d-sorts .chip').forEach((c) => c.classList.toggle('on', c === sc)); drawList(); return; }
    if (e.target.closest('#d-hideheard')) { dig.hideHeard = $('#d-hideheard', root).checked; drawList(); return; }
    const v = e.target.closest('[data-v]');
    if (v) { dig.view = v.dataset.v; drawList(); return; }
    if (e.target.closest('#d-go')) { dig.view = 'results'; run(); return; }
    const ps = e.target.closest('[data-pass]');
    if (ps) {
      const entry = entryFor(ps.dataset.pass);
      if (!entry) return;
      await saveSettings({ digPassed: [...passedList().filter((x) => x.k !== entry.key), { k: entry.key, c: slim(entry.c) }] });
      drawList();
      toast(`${entry.c.title} set aside. It waits under Not interested.`, { action: 'Undo', onAction: async () => { await saveSettings({ digPassed: passedList().filter((x) => x.k !== entry.key) }); drawList(); } });
      return;
    }
    const bk = e.target.closest('[data-back]');
    if (bk) {
      await saveSettings({ digPassed: passedList().filter((x) => x.k !== bk.dataset.back) });
      drawList();
      toast('Brought back. It shows in your results again.');
      return;
    }
    if (e.target.closest('#d-more')) { dig.shown += 40; drawList(); return; }
    const l = e.target.closest('[data-listen]');
    if (l) {
      const entry = entryFor(l.dataset.listen);
      if (!entry) return;
      listen(entry);
      // Opening Listen counts as heard. The list shows it straight away.
      await saveSettings({ digHeard: { ...heardMap(), [entry.key]: Date.now() } });
      drawList();
      return;
    }
    const w = e.target.closest('[data-want]');
    if (w) {
      const entry = entryFor(w.dataset.want);
      if (!entry) return;
      const rec = M.newRecord(entry.c, { wanted: true, wantDetail: true });
      await saveRecord(rec);
      kick();
      drawList();
      toast(`${rec.title} is on your wanted list`, { action: 'Undo', onAction: async () => { await removeWanted(rec); drawList(); } });
    }
  });

  drawList();
  return () => { token++; };
}
