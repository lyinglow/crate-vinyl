// The confirm sheet. Shows the sleeve and details of a match, lets you pick a different
// match or a different pressing, set the grades, and save. Used by every way of adding.
import { state, saveRecord, saveSettings, putPhoto, deleteRecord } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { esc, cover, openSheet, toast, chipRow, bindChips, describeError } from '../ui.js';
import { kick, removeFromCollection } from '../sync.js';

// The grades you picked last stay selected for the next record.
export const grades = { media: '', sleeve: '' };
function initGrades() {
  if (!grades.media) {
    grades.media = state.settings.mediaGrade || 'VG+';
    grades.sleeve = state.settings.sleeveGrade || 'VG+';
  }
}

const CODES = M.GRADES.map((g) => g.code);

function applyShell(rec, c) {
  Object.assign(rec, {
    source: 'discogs',
    releaseId: c.releaseId,
    masterId: c.masterId || null,
    artist: c.artist || rec.artist,
    title: c.title || rec.title,
    label: c.label,
    catno: c.catno,
    country: c.country,
    year: c.year || rec.year,
    formatTags: c.formatTags,
    formatText: c.formatText,
    genres: c.genres,
    styles: c.styles,
    thumb: c.thumb,
    cover: c.cover,
    detail: false,
    wantDetail: true,
    noCollection: false,
    fieldsDirty: true,
  });
}

async function undoAdd(rec) {
  const cur = state.records.get(rec.id);
  if (!cur) return;
  if (cur.instanceId) { try { await removeFromCollection(cur); } catch { /* ignore */ } }
  await deleteRecord(rec.id);
}

export function openMatchSheet({ cands, start = 0, barcode = '', labelBlob = null, linkTo = null, changeFor = null, onClose, onAdded }) {
  initGrades();
  let idx = start;
  let busy = false;
  const plain = !!(linkTo || changeFor);
  const photoUrl = labelBlob ? URL.createObjectURL(labelBlob) : '';

  const s = openSheet({
    className: 'match',
    onClose: () => { if (photoUrl) URL.revokeObjectURL(photoUrl); if (onClose) onClose(); },
    body: `
      <div class="m-top">
        <div class="m-cover" id="m-cover"></div>
        <div class="m-info" id="m-info"></div>
      </div>
      <p class="note" id="m-note" hidden></p>
      ${plain ? '' : `<div class="m-grades">
        <span class="lbl">Record</span>${chipRow(CODES, grades.media, { attr: 'id="g-media"' })}
        <span class="lbl">Sleeve</span>${chipRow(CODES, grades.sleeve, { attr: 'id="g-sleeve"' })}
      </div>`}
      <button class="btn primary big" id="m-add"></button>
      <div class="m-links">
        <button class="link" id="m-others" hidden></button>
        <button class="link" id="m-press">Other pressings</button>
        <button class="link" id="m-skip">${plain ? 'Cancel' : 'Skip'}</button>
      </div>
      <div id="m-list"></div>`,
  });
  const el = s.el;
  const $ = (q) => el.querySelector(q);

  if (!plain) {
    bindChips($('#g-media'), (c) => { if (c) { grades.media = c; saveSettings({ mediaGrade: c }); } });
    bindChips($('#g-sleeve'), (c) => { if (c) { grades.sleeve = c; saveSettings({ sleeveGrade: c }); } });
  }

  function fill() {
    const c = cands[idx];
    $('#m-cover').innerHTML = cover(c);
    const photo = photoUrl ? `<div class="m-photo"><img src="${photoUrl}" alt="Your label photo"><span>Your photo</span></div>` : '';
    $('#m-info').innerHTML = `
      <h3>${esc(c.artist || 'Unknown artist')}</h3>
      <p class="t">${esc(c.title)}</p>
      <p class="m">${esc([c.label, c.catno].filter(Boolean).join(' · '))}</p>
      <p class="m">${esc([c.country, c.year, M.formatShort(c)].filter(Boolean).join(' · '))}</p>
      ${photo}`;
    const note = $('#m-note');
    const have = [...state.records.values()].filter((r) => r.releaseId && r.releaseId === c.releaseId && r.status !== 'sold' && (!linkTo || r.id !== linkTo.id) && (!changeFor || r.id !== changeFor.id)).length;
    if (have && !plain) {
      note.hidden = false;
      note.textContent = `You already have ${have} cop${have > 1 ? 'ies' : 'y'} of this one.`;
    } else {
      note.hidden = true;
    }
    $('#m-add').textContent = changeFor ? 'Use this pressing' : linkTo ? 'Use this match' : have ? 'Add another copy' : 'Add to library';
    const others = $('#m-others');
    if (cands.length > 1) { others.hidden = false; others.textContent = `Other matches (${cands.length - 1})`; } else others.hidden = true;
    $('#m-press').hidden = !c.masterId;
  }
  fill();

  // ---- add ----
  $('#m-add').onclick = async () => {
    if (busy) return;
    busy = true;
    $('#m-add').disabled = true;
    const c = cands[idx];
    try {
      if (changeFor) {
        if (changeFor.instanceId) await removeFromCollection(changeFor);
        applyShell(changeFor, c);
        Object.assign(changeFor, { market: null, tracklist: undefined, images: undefined, identifiers: undefined, releaseNotes: '', community: null });
        await saveRecord(changeFor);
        kick();
        s.close();
        toast('Pressing changed');
      } else if (linkTo) {
        applyShell(linkTo, c);
        await saveRecord(linkTo);
        kick();
        s.close();
        toast('Matched on Discogs');
      } else {
        const rec = M.newRecord(c, {
          mediaGrade: grades.media,
          sleeveGrade: grades.sleeve,
          barcode: barcode || c.barcode || '',
          wantDetail: true,
        });
        if (labelBlob) {
          rec.photoLabel = `${rec.id}-label`;
          await putPhoto(rec.photoLabel, labelBlob);
        }
        await saveRecord(rec);
        kick();
        s.close();
        if (onAdded) onAdded(rec);
        toast(`Added ${rec.title}`, { action: 'Undo', onAction: () => undoAdd(rec) });
      }
    } catch (e) {
      toast(describeError(e));
      busy = false;
      $('#m-add').disabled = false;
    }
  };
  $('#m-skip').onclick = () => s.close();

  // ---- other matches ----
  $('#m-others').onclick = () => {
    const list = $('#m-list');
    list.innerHTML = `<div class="rows">${cands.map((c, i) => (i === idx ? '' : `
      <button class="vrow" data-i="${i}">
        <div class="vthumb">${cover(c, { small: true })}</div>
        <div class="vtext"><b>${esc(c.artist)} · ${esc(c.title)}</b><span>${esc([c.label, c.catno, c.country, c.year, M.formatShort(c)].filter(Boolean).join(' · '))}</span></div>
      </button>`)).join('')}</div>`;
    list.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ---- other pressings ----
  let verPage = 1;
  let verPages = 1;
  let versions = [];
  let verFilter = '';

  function drawVersions() {
    const list = $('#m-list');
    if (!list.querySelector('.vfilter')) {
      list.innerHTML = `<input class="vfilter" type="search" placeholder="Narrow down, for example UK or 1973" autocomplete="off" autocapitalize="off"><div class="rows" id="v-rows"></div><div id="v-more-wrap"></div>`;
      list.querySelector('.vfilter').oninput = (e) => { verFilter = e.target.value; drawVersions(); };
    }
    const words = M.norm(verFilter).split(/\s+/).filter(Boolean);
    const shown = versions.filter((v) => {
      const h = M.norm([v.label, v.catno, v.country, v.released, v.format].join(' '));
      return words.every((w) => h.includes(w));
    });
    list.querySelector('#v-rows').innerHTML = shown.map((v) => `
        <button class="vrow" data-v="${v.id}">
          <div class="vthumb">${cover({ artist: '', title: '', thumb: v.thumb, cover: v.thumb }, { small: true })}</div>
          <div class="vtext"><b>${esc([v.label, v.catno].filter(Boolean).join(' · ') || 'Unknown label')}</b><span>${esc([v.country, v.released, v.format].filter(Boolean).join(' · '))}</span></div>
        </button>`).join('') || '<p class="muted">Nothing matches that.</p>';
    const wrap = list.querySelector('#v-more-wrap');
    wrap.innerHTML = verPage < verPages ? '<button class="btn small" id="v-more">Show more pressings</button>' : '';
    const more = wrap.querySelector('#v-more');
    if (more) more.onclick = () => loadVersions(verPage + 1);
  }

  async function loadVersions(page) {
    const c = cands[idx];
    const list = $('#m-list');
    if (page === 1) list.innerHTML = '<p class="muted">Loading pressings...</p>';
    try {
      const res = await D.versions(c.masterId, page, { format: 'Vinyl' });
      verPage = page;
      verPages = (res.pagination && res.pagination.pages) || 1;
      versions = versions.concat(res.versions || []);
      drawVersions();
    } catch (e) {
      list.innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
    }
  }

  $('#m-press').onclick = () => {
    versions = [];
    verFilter = '';
    loadVersions(1);
    $('#m-list').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // taps inside the lists
  $('#m-list').addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    if (row.dataset.i) {
      idx = Number(row.dataset.i);
    } else if (row.dataset.v) {
      const v = versions.find((x) => String(x.id) === row.dataset.v);
      if (!v) return;
      cands.push(M.fromVersion(v, cands[idx]));
      idx = cands.length - 1;
    }
    $('#m-list').innerHTML = '';
    fill();
    s.sheet.scrollTop = 0;
  });

  return s;
}
