// Mixes: the list of mixes, one mix, and the sheets to add tracks.
import { state, subscribe } from '../store.js';
import * as M from '../model.js';
import * as X from '../mixes.js';
import { ensureDetail } from '../sync.js';
import { esc, cover, icon, openSheet, confirmSheet, toast, debounce, describeError, $ } from '../ui.js';

const miniCover = (t) => cover({ artist: t.artist, title: t.album, thumb: t.thumb, cover: t.cover || t.thumb }, { small: true });

export function mount(root, args) {
  return args[0] ? mountMix(root, args[0]) : mountList(root);
}

// ------------------------------------------------------------ all mixes

function mountList(root) {
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/library">${icon('back', 20)} Library</a>
      <div class="largetitle"><h1>Mixes</h1><p class="sub" id="mx-sub"></p></div>
      <button class="btn primary" id="new-mix">${icon('plus', 18)} New mix</button>
      <div id="mx-body"></div>
    </div>`;

  function draw() {
    const list = state.mixes;
    $('#mx-sub', root).textContent = list.length ? `${list.length} mix${list.length === 1 ? '' : 'es'}` : '';
    $('#mx-body', root).innerHTML = list.length
      ? `<div class="rows" style="margin-top:14px">${list.map((m) => {
        const secs = X.mixSeconds(m);
        const covers = m.tracks.slice(0, 3).map(miniCover).join('');
        return `<div class="mixcard" data-mix="${m.id}">
          <div class="stackcovers">${covers}</div>
          <div class="mtext"><b>${esc(m.name)}</b><span>${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'}${secs ? ' · ' + esc(X.span(secs)) : ''}</span></div>
        </div>`;
      }).join('')}</div>`
      : `<div class="empty small"><p>No mixes yet. Make one, then add tracks from any record's tracklist.</p></div>`;
  }
  draw();

  $('#new-mix', root).onclick = () => newMixSheet((m) => { location.hash = `#/mixes/${m.id}`; });
  root.addEventListener('click', (e) => {
    const c = e.target.closest('[data-mix]');
    if (c) location.hash = `#/mixes/${c.dataset.mix}`;
  });
  return subscribe((k) => { if (k === 'mixes') draw(); });
}

// ------------------------------------------------------------ one mix

function mountMix(root, id) {
  let editing = false;
  if (!X.getMix(id)) {
    root.innerHTML = `<div class="page"><a class="back" href="#/mixes">${icon('back', 20)} Mixes</a><div class="empty small"><p>That mix is not here any more.</p></div></div>`;
    return;
  }
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/mixes">${icon('back', 20)} Mixes</a>
      <div id="mx-head"></div>
      <div id="mx-tracks"></div>
    </div>`;

  function draw() {
    const m = X.getMix(id);
    if (!m) { location.hash = '#/mixes'; return; }
    const secs = X.mixSeconds(m);
    $('#mx-head', root).innerHTML = `
      <div class="largetitle"><h1>${esc(m.name)}</h1><p class="sub">${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'}${secs ? ' · ' + esc(X.span(secs)) : ''}</p></div>
      <div class="mixhead">
        <button class="btn small primary" id="add-crate">${icon('plus', 16)} Add from my crate</button>
        ${m.tracks.length ? `<button class="btn small" id="edit">${editing ? 'Done' : 'Edit'}</button><button class="btn small" id="share">Share list</button>` : ''}
        <button class="btn small" id="rename">Rename</button>
      </div>`;
    $('#mx-tracks', root).innerHTML = m.tracks.length
      ? `<div class="rows" style="margin-top:12px">${m.tracks.map((t, i) => `
        <div class="mrow" ${editing ? '' : `data-go="${esc(t.recordId)}"`}>
          <span class="mn">${i + 1}</span>
          <div class="mthumb">${miniCover(t)}</div>
          <div class="mtext"><b>${esc(t.title)}</b><span>${esc(t.artist)} · ${esc(t.album)}</span></div>
          ${editing
    ? `<div class="mctl"><button data-up="${t.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${icon('up', 16)}</button><button data-down="${t.id}" ${i === m.tracks.length - 1 ? 'disabled' : ''} aria-label="Move down">${icon('down', 16)}</button><button data-del="${t.id}" aria-label="Remove">${icon('close', 16)}</button></div>`
    : `<span class="md">${esc(t.duration)}</span>`}
        </div>`).join('')}</div>`
      : `<div class="empty small"><p>Nothing in this mix yet. Tap Add from my crate, or tap + next to any track on a record page.</p></div>`;

    const on = (sel, fn) => { const b = $(sel, root); if (b) b.onclick = fn; };
    on('#add-crate', () => openCratePicker(id));
    on('#edit', () => { editing = !editing; draw(); });
    on('#rename', () => renameSheet(m));
    on('#share', () => shareMix(m));
  }
  draw();

  root.addEventListener('click', async (e) => {
    const up = e.target.closest('[data-up]');
    const down = e.target.closest('[data-down]');
    const del = e.target.closest('[data-del]');
    if (up) return X.moveTrack(id, up.dataset.up, -1);
    if (down) return X.moveTrack(id, down.dataset.down, 1);
    if (del) return X.removeTrack(id, del.dataset.del);
    const go = e.target.closest('[data-go]');
    if (go && state.records.has(go.dataset.go)) location.hash = `#/record/${go.dataset.go}`;
  });
  return subscribe((k) => { if (k === 'mixes') draw(); });
}

async function shareMix(m) {
  const text = X.mixText(m);
  try {
    if (navigator.share) { await navigator.share({ title: m.name, text }); return; }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied. Paste it anywhere.');
  } catch {
    toast('Could not copy the list.');
  }
}

// ------------------------------------------------------------ sheets

function newMixSheet(done) {
  const s = openSheet({
    title: 'New mix',
    body: `<form id="nm"><label class="field"><span>Name</span><input name="name" placeholder="For example Friday night" autocomplete="off" required></label>
      <div class="stack"><button class="btn primary" type="submit">Create</button><button class="btn ghost" type="button" id="no">Cancel</button></div></form>`,
  });
  const form = s.el.querySelector('#nm');
  setTimeout(() => form.name.focus(), 350);
  s.el.querySelector('#no').onclick = () => s.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const m = await X.createMix(form.name.value);
    s.close();
    done(m);
  };
}

function renameSheet(m) {
  const s = openSheet({
    title: 'Rename or delete',
    body: `<form id="rn"><label class="field"><span>Name</span><input name="name" value="${esc(m.name)}" autocomplete="off" required></label>
      <div class="stack"><button class="btn primary" type="submit">Save</button><button class="btn ghost danger-text" type="button" id="del">Delete this mix</button></div></form>`,
  });
  const form = s.el.querySelector('#rn');
  form.onsubmit = async (e) => { e.preventDefault(); await X.renameMix(m.id, form.name.value); s.close(); };
  s.el.querySelector('#del').onclick = async () => {
    s.close();
    const ok = await confirmSheet({ title: 'Delete this mix?', text: `${m.name} and its ${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'} will be removed. Your records are not touched.`, yes: 'Delete mix', danger: true });
    if (!ok) return;
    await X.deleteMix(m.id);
    toast('Mix deleted');
    location.hash = '#/mixes';
  };
}

// From a record page: choose which mix a track goes into.
export function openAddToMix(rec, track) {
  const s = openSheet({ title: 'Add to a mix', body: '<div id="am"></div>' });
  function draw() {
    const box = s.el.querySelector('#am');
    box.innerHTML = `
      <p class="muted" style="margin-bottom:6px"><b>${esc(track.title)}</b><br>${esc(rec.artist)} · ${esc(rec.title)}</p>
      <div class="rows">${state.mixes.map((m) => `
        <button class="pick-row" data-mix="${m.id}">
          <span>${esc(m.name)}<small>${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'}</small></span>
          ${X.inMix(m, rec, track) ? '<span class="ok">Added</span>' : `<span>${icon('plus', 20)}</span>`}
        </button>`).join('')}</div>
      <form id="nm2" style="margin-top:16px"><label class="field"><span>Or start a new mix</span><input name="name" placeholder="Mix name" autocomplete="off"></label>
        <button class="btn" type="submit">Create and add</button></form>`;
    box.querySelector('#nm2').onsubmit = async (e) => {
      e.preventDefault();
      const name = e.target.name.value.trim();
      if (!name) { toast('Give the mix a name.'); return; }
      const m = await X.createMix(name);
      await X.addTrack(m.id, rec, track);
      toast(`Added to ${m.name}`);
      s.close();
    };
    box.querySelectorAll('[data-mix]').forEach((b) => {
      b.onclick = async () => {
        const m = X.getMix(b.dataset.mix);
        const ok = await X.addTrack(m.id, rec, track);
        toast(ok ? `Added to ${m.name}` : `Already in ${m.name}`);
        if (ok) s.close();
      };
    });
  }
  draw();
}

// Several tracks at once, for example everything on the Loved tracks page.
export function openAddManyToMix(items) {
  const s = openSheet({ title: `Add ${items.length} track${items.length === 1 ? '' : 's'} to a mix`, body: '<div id="am"></div>' });
  async function addTo(mix) {
    let n = 0;
    for (const { rec, track } of items) if (await X.addTrack(mix.id, rec, track)) n++;
    const skipped = items.length - n;
    toast(`Added ${n} to ${mix.name}${skipped ? `. ${skipped} already there.` : ''}`);
    s.close();
  }
  const box = s.el.querySelector('#am');
  box.innerHTML = `
    <div class="rows">${state.mixes.map((m) => `<button class="pick-row" data-mix="${m.id}"><span>${esc(m.name)}<small>${m.tracks.length} track${m.tracks.length === 1 ? '' : 's'}</small></span><span>${icon('plus', 20)}</span></button>`).join('')}</div>
    <form id="nm3" style="margin-top:16px"><label class="field"><span>Or start a new mix</span><input name="name" placeholder="Mix name" autocomplete="off"></label><button class="btn" type="submit">Create and add</button></form>`;
  box.querySelectorAll('[data-mix]').forEach((b) => { b.onclick = () => addTo(X.getMix(b.dataset.mix)); });
  box.querySelector('#nm3').onsubmit = async (e) => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) { toast('Give the mix a name.'); return; }
    addTo(await X.createMix(name));
  };
}

// From a mix: search your records, then pick tracks.
function openCratePicker(mixId) {
  const s = openSheet({ title: 'Add from my crate', body: '<div id="cp"></div>' });
  const box = s.el.querySelector('#cp');
  let q = '';

  function drawSearch() {
    box.innerHTML = `<input id="cq" type="search" placeholder="Search artist, title or label" autocomplete="off" autocapitalize="off" value="${esc(q)}"><div id="cres" class="rows" style="margin-top:10px"></div>`;
    const input = box.querySelector('#cq');
    const res = box.querySelector('#cres');
    const run = () => {
      const list = M.sortRecords(M.filterRecords([...state.records.values()], { q, status: 'all' }), q ? 'artist' : 'added').slice(0, 30);
      res.innerHTML = list.length
        ? list.map((r) => `<button class="vrow" data-rec="${r.id}"><div class="vthumb">${cover(r, { small: true })}</div><div class="vtext"><b>${esc(r.artist)}</b><span>${esc(r.title)}${r.year ? ' · ' + r.year : ''}</span></div></button>`).join('')
        : '<p class="muted" style="padding-top:12px">No records match.</p>';
    };
    input.oninput = debounce(() => { q = input.value; run(); }, 150);
    res.onclick = (e) => {
      const b = e.target.closest('[data-rec]');
      if (b) drawTracks(state.records.get(b.dataset.rec));
    };
    run();
  }

  async function drawTracks(rec) {
    box.innerHTML = `<button class="link" id="back">Back to search</button><p style="margin:10px 0 4px"><b>${esc(rec.artist)}</b><br><span class="muted">${esc(rec.title)}</span></p><div id="tl" class="sheet-tracks"><p class="muted">Loading the tracklist...</p></div>`;
    box.querySelector('#back').onclick = drawSearch;
    try {
      await ensureDetail(rec);
    } catch (e) {
      box.querySelector('#tl').innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
      return;
    }
    const tracks = (rec.tracklist || []).filter((t) => !t.heading);
    const paint = () => {
      const m = X.getMix(mixId);
      box.querySelector('#tl').innerHTML = tracks.length
        ? `<div class="rows">${tracks.map((t, i) => `<button class="pick-row" data-t="${i}"><span>${M.isLoved(rec, t) ? `<span class="loved">${icon('heart', 14)}</span> ` : ''}${esc(t.position)} ${esc(t.title)}<small>${esc(t.duration)}</small></span>${X.inMix(m, rec, t) ? '<span class="ok">Added</span>' : `<span>${icon('plus', 20)}</span>`}</button>`).join('')}</div>`
        : '<p class="muted">No tracklist for this record. Records added by hand have none.</p>';
    };
    paint();
    box.querySelector('#tl').onclick = async (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      const t = tracks[Number(b.dataset.t)];
      if (await X.addTrack(mixId, rec, t)) paint();
    };
  }

  drawSearch();
  setTimeout(() => { const i = box.querySelector('#cq'); if (i) i.focus(); }, 350);
}
