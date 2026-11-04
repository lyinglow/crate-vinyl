// Adding records. Three ways: barcode (camera), search (catalogue number, artist, title), by hand.
import { state, saveRecord, putPhoto } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { esc, cover, icon, openSheet, toast, chipRow, bindChips, pickPhoto, hydratePhotos, describeError } from '../ui.js';
import { Scanner, decodeFile, beep, unlockAudio } from '../scanner.js';
import { openMatchSheet, grades } from './match.js';
import { kick } from '../sync.js';

// Lives as long as the app is open: what you added in this sitting.
const session = { added: [] };
// Carried between screens (for example from "not found" to search).
let prefill = {};

function seg(mode, linkId) {
  const tabs = [['barcode', 'Barcode'], ['search', 'Search'], ['manual', 'By hand']];
  return `<div class="seg" role="tablist">${tabs.map(([m, l]) => `<a role="tab" class="${m === mode ? 'on' : ''}" href="#/scan/${m}${linkId && m === 'search' ? '/' + linkId : ''}">${l}</a>`).join('')}</div>`;
}

export function mount(root, args) {
  const mode = args[0] || 'barcode';
  const linkId = args[1] || '';
  if (mode === 'search') return mountSearch(root, linkId);
  if (mode === 'manual') return mountManual(root);
  return mountBarcode(root);
}

// ---------------------------------------------------------------- barcode

async function lookupBarcode(code) {
  const tries = [code];
  if (code.length === 13 && code[0] === '0') tries.push(code.slice(1));
  if (code.length === 12) tries.push('0' + code);
  for (const t of tries) {
    const res = await D.search({ type: 'release', barcode: t });
    const list = (res.results || []).map(M.fromSearch);
    if (list.length) {
      list.forEach((c) => { c.barcode = code; });
      // vinyl first, keep Discogs order inside each group
      return list.filter(M.isVinyl).concat(list.filter((c) => !M.isVinyl(c)));
    }
  }
  return [];
}

function mountBarcode(root) {
  root.innerHTML = `
    <div class="page scan">
      ${seg('barcode')}
      <div class="viewport" id="vp">
        <video id="cam" playsinline muted autoplay></video>
        <div class="scanguide" id="guide"></div>
        <div class="vp-msg" id="vp-msg">Starting the camera...</div>
      </div>
      <div class="scan-row">
        <div class="count"><b id="n-added">${session.added.length}</b> added this sitting</div>
        <button class="btn small" id="btn-photo">${icon('camera', 18)} Photo of barcode</button>
      </div>
      <form id="bc-form" class="inline-form">
        <input id="bc-input" inputmode="numeric" pattern="[0-9]*" placeholder="Or type the barcode numbers" autocomplete="off">
        <button class="btn small primary" type="submit">Find</button>
      </form>
      <div class="strip" id="strip"></div>
    </div>`;

  const video = root.querySelector('#cam');
  const guide = root.querySelector('#guide');
  const msg = root.querySelector('#vp-msg');
  const setMsg = (t) => { msg.textContent = t; msg.classList.toggle('hide', !t); };
  const scanner = new Scanner(video, guide);
  let busy = false;
  let gone = false;

  function drawStrip() {
    const recs = session.added.map((id) => state.records.get(id)).filter(Boolean).slice(0, 14);
    root.querySelector('#strip').innerHTML = recs.map((r) => `<a href="#/record/${r.id}">${cover(r, { small: true })}</a>`).join('');
    root.querySelector('#n-added').textContent = session.added.length;
  }
  drawStrip();

  function release() {
    busy = false;
    if (!gone) { scanner.resume(); setMsg('Point at the next barcode'); }
  }

  async function onCode(code) {
    if (busy) return;
    busy = true;
    scanner.pause();
    beep();
    setMsg(`Looking up ${code}...`);
    try {
      const cands = await lookupBarcode(code);
      if (gone) return;
      if (!cands.length) {
        setMsg('');
        notFound(code);
      } else {
        openMatchSheet({
          cands,
          barcode: code,
          onClose: release,
          onAdded: (rec) => { session.added.unshift(rec.id); drawStrip(); },
        });
      }
    } catch (e) {
      toast(describeError(e));
      release();
    }
  }

  function notFound(code) {
    const s = openSheet({
      title: 'No match for this barcode',
      onClose: release,
      body: `<p class="muted">Discogs does not know ${esc(code)}. This is common for older records. Try the catalogue number, or add it by hand.</p>
        <div class="stack">
          <button class="btn primary" id="nf-search">Search by catalogue number</button>
          <button class="btn" id="nf-manual">Add by hand</button>
          <button class="btn ghost" id="nf-skip">Scan the next one</button>
        </div>`,
    });
    s.el.querySelector('#nf-search').onclick = () => { prefill = { barcode: code }; s.close(); location.hash = '#/scan/search'; };
    s.el.querySelector('#nf-manual').onclick = () => { prefill = { barcode: code }; s.close(); location.hash = '#/scan/manual'; };
    s.el.querySelector('#nf-skip').onclick = () => s.close();
  }

  root.querySelector('#bc-form').onsubmit = (e) => {
    e.preventDefault();
    unlockAudio();
    const input = root.querySelector('#bc-input');
    const code = input.value.replace(/\D/g, '');
    if (code.length < 8) { toast('A barcode has 8 to 13 numbers.'); return; }
    input.value = '';
    input.blur();
    onCode(code);
  };

  root.querySelector('#btn-photo').onclick = async () => {
    unlockAudio();
    const f = await new Promise((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = 'image/*';
      i.onchange = () => resolve(i.files && i.files[0]);
      i.addEventListener('cancel', () => resolve(null));
      i.click();
    });
    if (!f) return;
    setMsg('Reading the photo...');
    try {
      const code = await decodeFile(f);
      if (!code) { setMsg('Point at the next barcode'); toast('Could not read a barcode in that photo.'); return; }
      onCode(code);
    } catch (e) { toast(describeError(e)); }
  };

  root.addEventListener('touchstart', unlockAudio, { once: true, passive: true });

  scanner.start(onCode).then(() => setMsg('Point at the barcode')).catch((e) => {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    setMsg(denied ? 'Camera access is off. Turn it on in iPhone Settings, or type the barcode below.' : (e && e.message) || 'The camera did not start.');
  });

  const onVis = () => { if (document.hidden) scanner.pause(); else if (!busy) scanner.resume(); };
  document.addEventListener('visibilitychange', onVis);

  return () => {
    gone = true;
    document.removeEventListener('visibilitychange', onVis);
    scanner.stop();
  };
}

// ---------------------------------------------------------------- search

function mountSearch(root, linkId) {
  const linkTo = linkId ? state.records.get(linkId) : null;
  const pre = { catno: '', artist: linkTo ? linkTo.artist : '', title: linkTo ? linkTo.title : '', ...prefill };
  if (linkTo && linkTo.catno) pre.catno = linkTo.catno;
  prefill = {};
  let labelBlob = null;
  let results = [];
  let page = 1;
  let pages = 1;
  let lastQuery = null;

  root.innerHTML = `
    <div class="page scan">
      ${seg('search', linkId)}
      ${linkTo ? `<p class="note">Finding a match for <b>${esc(linkTo.artist)} · ${esc(linkTo.title)}</b></p>` : ''}
      <form id="sf" class="form">
        <label class="field"><span>Catalogue number</span><input name="catno" value="${esc(pre.catno)}" placeholder="For example SRK 3573" autocomplete="off" autocapitalize="characters"></label>
        <div class="two">
          <label class="field"><span>Artist</span><input name="artist" value="${esc(pre.artist)}" autocomplete="off"></label>
          <label class="field"><span>Title</span><input name="title" value="${esc(pre.title)}" autocomplete="off"></label>
        </div>
        ${pre.barcode ? `<label class="field"><span>Barcode</span><input name="barcode" value="${esc(pre.barcode)}" inputmode="numeric"></label>` : ''}
        <label class="check"><input type="checkbox" name="vinyl" checked> Vinyl only</label>
        <div class="row-btns">
          <button class="btn primary" type="submit">Search</button>
          <button class="btn" type="button" id="btn-label">${icon('camera', 18)} Label photo</button>
        </div>
      </form>
      <div id="label-preview"></div>
      <p class="hint-text">The catalogue number is printed on the label and usually on the spine. It is the most reliable way to find an older record. A photo of the label cannot be read for you, but you can hold it up next to the results to check the pressing.</p>
      <div id="results"></div>
    </div>`;

  const form = root.querySelector('#sf');
  const out = root.querySelector('#results');

  root.querySelector('#btn-label').onclick = async () => {
    const b = await pickPhoto({ camera: true });
    if (!b) return;
    labelBlob = b;
    const url = URL.createObjectURL(b);
    root.querySelector('#label-preview').innerHTML = `<div class="label-card"><img src="${url}" alt="Label photo"><div><b>Label photo</b><span>Tap a result to compare. It is saved with the record you add.</span></div></div>`;
  };

  function buildQuery() {
    const fd = new FormData(form);
    const q = { type: 'release' };
    const catno = (fd.get('catno') || '').trim();
    const artist = (fd.get('artist') || '').trim();
    const title = (fd.get('title') || '').trim();
    const barcode = ((fd.get('barcode') || '') + '').replace(/\D/g, '');
    if (catno) q.catno = catno;
    if (artist) q.artist = artist;
    if (title) q.release_title = title;
    if (barcode) q.barcode = barcode;
    if (fd.get('vinyl')) q.format = 'Vinyl';
    return q;
  }

  function drawResults() {
    if (!results.length) {
      out.innerHTML = `<div class="empty small"><p>No results. Try fewer words, or only the catalogue number.</p><a class="btn small" href="#/scan/manual">Add by hand</a></div>`;
      return;
    }
    out.innerHTML = `<div class="rows">${results.map((c, i) => `
      <button class="vrow" data-i="${i}">
        <div class="vthumb">${cover(c, { small: true })}</div>
        <div class="vtext"><b>${esc(c.artist)} · ${esc(c.title)}</b><span>${esc([c.label, c.catno, c.country, c.year, M.formatShort(c)].filter(Boolean).join(' · '))}</span></div>
      </button>`).join('')}</div>
      ${page < pages ? '<button class="btn small" id="more">Show more</button>' : ''}`;
    const more = out.querySelector('#more');
    if (more) more.onclick = () => run(page + 1);
  }

  async function run(p) {
    const q = lastQuery;
    if (p === 1) out.innerHTML = '<p class="muted center">Searching...</p>';
    try {
      let res = await D.search(q, p);
      let found = res.results || [];
      // Nothing? Try the catalogue number as plain words. Discogs is fussy about spaces.
      if (!found.length && p === 1 && q.catno) {
        const q2 = { type: 'release', q: [q.catno, q.artist].filter(Boolean).join(' ') };
        if (q.format) q2.format = q.format;
        res = await D.search(q2, 1);
        found = res.results || [];
      }
      page = p;
      pages = (res.pagination && res.pagination.pages) || 1;
      const shells = found.map(M.fromSearch);
      results = p === 1 ? shells : results.concat(shells);
      drawResults();
    } catch (e) {
      out.innerHTML = `<p class="muted center">${esc(describeError(e))}</p>`;
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    const q = buildQuery();
    if (!q.catno && !q.artist && !q.release_title && !q.barcode) { toast('Type a catalogue number, or an artist and title.'); return; }
    lastQuery = q;
    document.activeElement && document.activeElement.blur();
    run(1);
  };

  out.addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    const i = Number(row.dataset.i);
    openMatchSheet({
      cands: results.slice(),
      start: i,
      barcode: lastQuery && lastQuery.barcode ? lastQuery.barcode : '',
      labelBlob,
      linkTo,
      onAdded: (rec) => { session.added.unshift(rec.id); labelBlob = null; root.querySelector('#label-preview').innerHTML = ''; },
      onClose: () => {
        const r = linkTo && state.records.get(linkTo.id);
        if (r && r.releaseId) location.hash = `#/record/${r.id}`;
      },
    });
  });

  if ((pre.catno || (pre.artist && pre.title) || pre.barcode) && (linkTo || pre.barcode)) {
    lastQuery = buildQuery();
    run(1);
  }
  return () => {};
}

// ---------------------------------------------------------------- by hand

const SIZES = ['LP', '12"', '10"', '7"', 'EP', 'Box set'];

function mountManual(root) {
  const pre = prefill;
  prefill = {};
  let sleeve = null;
  let label = null;
  let size = 'LP';

  root.innerHTML = `
    <div class="page scan">
      ${seg('manual')}
      <p class="hint-text">For white labels and anything Discogs does not have. You can match it to Discogs later from its page.</p>
      <form id="mf" class="form">
        <label class="field"><span>Artist</span><input name="artist" required autocomplete="off"></label>
        <label class="field"><span>Title</span><input name="title" required autocomplete="off"></label>
        <div class="two">
          <label class="field"><span>Label</span><input name="label" autocomplete="off"></label>
          <label class="field"><span>Catalogue number</span><input name="catno" autocomplete="off" autocapitalize="characters"></label>
        </div>
        <div class="two">
          <label class="field"><span>Year</span><input name="year" inputmode="numeric" pattern="[0-9]*" maxlength="4"></label>
          <label class="field"><span>Barcode</span><input name="barcode" inputmode="numeric" value="${esc(pre.barcode || '')}"></label>
        </div>
        <div class="field"><span>Format</span><div class="chips" id="sizes">${SIZES.map((s) => `<button type="button" class="chip${s === size ? ' on' : ''}" data-code="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>
        <div class="field"><span>Record</span>${chipRow(M.GRADES.map((g) => g.code), grades.media || state.settings.mediaGrade, { attr: 'id="g-media"' })}</div>
        <div class="field"><span>Sleeve</span>${chipRow(M.GRADES.map((g) => g.code), grades.sleeve || state.settings.sleeveGrade, { attr: 'id="g-sleeve"' })}</div>
        <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Anything useful: test pressing, signed, where you got it"></textarea></label>
        <div class="two photos">
          <button type="button" class="photo-btn" id="p-sleeve"><span>${icon('camera', 22)}</span>Sleeve photo</button>
          <button type="button" class="photo-btn" id="p-label"><span>${icon('camera', 22)}</span>Label photo</button>
        </div>
        <button class="btn primary big" type="submit">Save record</button>
      </form>
    </div>`;

  const form = root.querySelector('#mf');
  let mg = grades.media || state.settings.mediaGrade;
  let sg = grades.sleeve || state.settings.sleeveGrade;
  bindChips(root.querySelector('#sizes'), (c) => { if (c) size = c; });
  bindChips(root.querySelector('#g-media'), (c) => { if (c) mg = c; });
  bindChips(root.querySelector('#g-sleeve'), (c) => { if (c) sg = c; });

  const showPhoto = (btn, blob) => {
    const url = URL.createObjectURL(blob);
    btn.classList.add('has');
    btn.innerHTML = `<img src="${url}" alt="">`;
  };
  const sleeveBtn = root.querySelector('#p-sleeve');
  const labelBtn = root.querySelector('#p-label');
  sleeveBtn.onclick = async () => { const b = await pickPhoto(); if (b) { sleeve = b; showPhoto(sleeveBtn, b); } };
  labelBtn.onclick = async () => { const b = await pickPhoto(); if (b) { label = b; showPhoto(labelBtn, b); } };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const g = (k) => String(fd.get(k) || '').trim();
    const year = Number(g('year')) || null;
    const tags = ['Vinyl', size];
    const rec = M.newRecord({
      source: 'manual',
      releaseId: null,
      artist: g('artist'),
      title: g('title'),
      label: g('label'),
      catno: g('catno'),
      year,
      barcode: g('barcode').replace(/\D/g, ''),
      country: '',
      formatTags: tags,
      formatText: tags.join(', '),
      genres: [],
      styles: [],
      thumb: '',
      cover: '',
    }, { mediaGrade: mg, sleeveGrade: sg, notes: g('notes') });
    if (sleeve) { rec.photoSleeve = `${rec.id}-sleeve`; await putPhoto(rec.photoSleeve, sleeve); }
    if (label) { rec.photoLabel = `${rec.id}-label`; await putPhoto(rec.photoLabel, label); }
    await saveRecord(rec);
    session.added.unshift(rec.id);
    toast(`Saved ${rec.title}`);
    // Stay on this screen, ready for the next one.
    form.reset();
    root.querySelectorAll('.photo-btn').forEach((b) => { b.classList.remove('has'); });
    root.querySelector('#p-sleeve').innerHTML = `<span>${icon('camera', 22)}</span>Sleeve photo`;
    root.querySelector('#p-label').innerHTML = `<span>${icon('camera', 22)}</span>Label photo`;
    sleeve = null; label = null;
    window.scrollTo(0, 0);
  };
  return () => {};
}
