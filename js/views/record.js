// One record: sleeve, status, condition, value, notes, tracklist, pressing details.
import { state, saveRecord, deleteRecord, subscribe } from '../store.js';
import * as M from '../model.js';
import { refreshMarket, ensureDetail, removeFromCollection, deleteListing, kick, gotIt, removeWanted } from '../sync.js';
import { priceLine } from './wanted.js';
import { esc, icon, openSheet, confirmSheet, toast, chipRow, bindChips, hydratePhotos, describeError, $ } from '../ui.js';
import { openSellSheet, openSoldSheet } from './sell.js';
import { openMatchSheet } from './match.js';
import { mountFlipper } from '../flipper.js';
import { filterState as F } from './library.js';
import * as SP from '../spotify.js';
import { gallerySlides } from '../gallery.js';
import { openAddToMix, openFindInMixes } from './mixes.js';

const CODES = M.GRADES.map((g) => g.code);

export function mount(root, args) {
  const id = args[0];
  const rec = state.records.get(id);
  if (!rec) {
    root.innerHTML = `<div class="page"><a class="back" href="#/library">${icon('back', 20)} Library</a><div class="empty small"><p>That record is not here any more.</p></div></div>`;
    return;
  }

  root.innerHTML = `
    <div class="page record">
      <a class="back" href="${rec.wanted ? '#/wanted' : '#/library'}" id="back">${icon('back', 20)} ${rec.wanted ? 'Wanted' : 'Library'}</a>
      <div id="r-gallery"></div>
      <div id="r-head"></div>
      <div id="r-status"></div>
      <section class="card" id="r-cond"></section>
      <section class="card" id="r-value"></section>
      <section id="r-notes"></section>
      <section id="r-listen"></section>
      <section id="r-tracks"></section>
      <section id="r-details"></section>
      <section id="r-actions"></section>
    </div>`;
  $('#back', root).onclick = (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } };

  const save = async (quiet = true) => { await saveRecord(rec, { quiet }); };
  const touchGrades = () => { if (rec.instanceId) rec.fieldsDirty = true; };

  // ------------------------------------------------------ gallery
  // Tap the picture to turn it over. Drag it sideways to turn it with your finger.
  let galIdx = 0;
  let galSig = '';
  function drawGallery() {
    const host = $('#r-gallery', root);
    const sig = gallerySlides(rec).map((s) => s.src || s.photo).join('|');
    if (sig === galSig && host.querySelector('.flipper')) return;
    galSig = sig;
    mountFlipper(host, rec, { start: galIdx, vtName: true, onIndex: (i) => { galIdx = i; } });
  }

  // ------------------------------------------------------ head
  function drawHead() {
    const bits = [rec.label, rec.catno].filter(Boolean).join(' · ');
    const more = [rec.country, rec.year, M.formatShort(rec)].filter(Boolean).join(' · ');
    $('#r-head', root).innerHTML = `
      <h1 class="rtitle">${esc(rec.title)}</h1>
      <p class="rartist">${esc(rec.artist || 'Unknown artist')}</p>
      <p class="cap-love left" id="r-love" hidden></p>
      ${bits ? `<p class="meta">${esc(bits)}</p>` : ''}
      ${more ? `<p class="meta">${esc(more)}</p>` : ''}
      ${rec.source === 'manual' ? '<p class="meta">Added by hand. Not matched to Discogs.</p>' : ''}
      ${(rec.genres || []).length || (rec.styles || []).length ? `<div class="chips tags" id="r-tags">${(rec.genres || []).map((g) => `<button class="chip" data-genre="${esc(g)}">${esc(g)}</button>`).join('')}${(rec.styles || []).map((x) => `<button class="chip soft" data-style="${esc(x)}">${esc(x)}</button>`).join('')}</div>` : ''}`;
    drawLove();
    const tags = $('#r-tags', root);
    if (tags) {
      tags.onclick = (e) => {
        const g = e.target.closest('[data-genre]');
        const st = e.target.closest('[data-style]');
        if (!g && !st) return;
        // Show every record of this kind in the cover flow.
        Object.assign(F, { q: '', status: 'all', genre: g ? g.dataset.genre : '', style: st ? st.dataset.style : '', label: '', artist: '', format: '', from: '', to: '' });
        location.hash = '#/library';
      };
    }
  }

  function drawLove() {
    const el = $('#r-love', root);
    if (!el) return;
    const n = (rec.loved || []).length;
    el.hidden = !n;
    el.innerHTML = n ? `${icon('heart', 15)}<span>${n} loved track${n === 1 ? '' : 's'}</span>` : '';
  }

  // ------------------------------------------------------ status
  function drawStatus() {
    const el = $('#r-status', root);
    if (rec.wanted) {
      // On the wanted list: no grades, no selling. What it costs, and a way to move it to the library.
      const price = priceLine(rec);
      el.innerHTML = `<div class="card wantcard">
        <p class="meta">On your wanted list</p>
        ${price ? `<p class="bignum">${esc(price)}</p>` : ''}
        <div class="stack">
          <button class="btn primary" id="w-got">I got it</button>
          ${rec.releaseId ? `<a class="btn" href="https://www.discogs.com/sell/release/${esc(String(rec.releaseId))}" target="_blank" rel="noopener">Find one for sale on Discogs</a>` : ''}
          <button class="btn ghost danger-text" id="w-remove">Remove from wanted</button>
        </div></div>`;
      $('#w-got', el).onclick = async () => {
        const ok = await confirmSheet({ title: 'Got it?', text: `${rec.artist}, ${rec.title}\n\nIt moves to your library. Set its grade on this page.`, yes: 'Move to my library' });
        if (!ok) return;
        await gotIt(rec);
        toast('In your library');
        redrawAll();
      };
      $('#w-remove', el).onclick = async () => {
        const ok = await confirmSheet({ title: 'Remove from wanted?', text: `${rec.artist}, ${rec.title}`, yes: 'Remove', danger: true });
        if (!ok) return;
        await removeWanted(rec);
        toast('Removed');
        location.hash = '#/wanted';
      };
      return;
    }
    el.innerHTML = `<div class="seg three">${Object.entries(M.STATUS).map(([k, l]) => `<button data-st="${k}" class="${rec.status === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${rec.status === 'for_sale' ? `<p class="meta center">${rec.askPrice ? 'Asking ' + esc(M.money(rec.askPrice, (rec.market && rec.market.currency) || state.settings.currency)) : ''}${rec.listingStatus ? ' · ' + esc(rec.listingStatus) + ' on Discogs' : rec.askPrice ? ' · not listed on Discogs' : ''}</p>` : ''}
      ${rec.status === 'sold' ? `<p class="meta center">Sold ${esc(M.dateStr(rec.soldAt))}${rec.soldPrice ? ' for ' + esc(M.money(rec.soldPrice, (rec.market && rec.market.currency) || state.settings.currency)) : ''}</p>` : ''}`;
  }

  async function setStatus(next) {
    if (next === rec.status) { if (next === 'for_sale') openSellSheet(rec, redrawAll); return; }
    if (next === 'for_sale') { openSellSheet(rec, redrawAll); return; }
    if (next === 'sold') { openSoldSheet(rec, redrawAll); return; }
    // back to keeping
    const live = rec.listingId && (rec.listingStatus === 'For Sale' || rec.listingStatus === 'Draft');
    if (live) {
      const ok = await confirmSheet({ title: 'Back to Keeping?', text: 'This record is listed on Discogs. The listing will be deleted.', yes: 'Delete the listing', danger: true });
      if (!ok) return;
      try { await deleteListing(rec); } catch (e) { toast(describeError(e)); return; }
      rec.listingStatus = 'Deleted';
    }
    rec.status = 'keeping';
    rec.noCollection = false;
    await save(false);
    kick();
    drawStatus();
    drawValue();
  }

  // ------------------------------------------------------ condition
  function drawCond() {
    $('#r-cond', root).hidden = !!rec.wanted;
    if (rec.wanted) return;
    const mg = M.GRADES.find((g) => g.code === rec.mediaGrade);
    const sg = M.GRADES.find((g) => g.code === rec.sleeveGrade);
    $('#r-cond', root).innerHTML = `
      <h3>Condition</h3>
      <div class="field"><span>Record</span>${chipRow(CODES, rec.mediaGrade, { attr: 'id="c-media" data-toggle' })}<p class="blurb">${esc(mg ? mg.blurb : 'Not graded yet. Tap a grade.')}</p></div>
      <div class="field"><span>Sleeve</span>${chipRow(CODES, rec.sleeveGrade, { attr: 'id="c-sleeve" data-toggle' })}
        <div class="chips extra" id="c-extra">${M.SLEEVE_EXTRAS.map((x) => `<button type="button" class="chip${rec.sleeveGrade === x.code ? ' on' : ''}" data-code="${esc(x.code)}">${esc(x.name)}</button>`).join('')}</div>
        <p class="blurb">${esc(sg ? sg.blurb : '')}</p></div>
      <details class="guide"><summary>What do the grades mean?</summary>
        <ul>${M.GRADES.map((g) => `<li><b>${g.code}</b> ${esc(g.blurb)}</li>`).join('')}</ul>
        <p class="muted">This is the Goldmine scale, the one Discogs uses.</p></details>`;
    const pick = (key) => (c) => { rec[key] = c; touchGrades(); save().then(() => { kick(); drawCond(); drawValue(); }); };
    bindChips($('#c-media', root), pick('mediaGrade'));
    const sleeveRow = $('#c-sleeve', root);
    bindChips(sleeveRow, pick('sleeveGrade'));
    bindChips($('#c-extra', root), pick('sleeveGrade'));
  }

  // ------------------------------------------------------ value
  function drawValue() {
    const el = $('#r-value', root);
    el.hidden = !!rec.wanted;
    if (rec.wanted) return;
    if (rec.source !== 'discogs' || !rec.releaseId) {
      el.innerHTML = `<h3>Value</h3><p class="muted">Match this record to Discogs to see what it is worth.</p>`;
      return;
    }
    const m = rec.market || {};
    const cur = m.currency || state.settings.currency;
    const est = M.estimate(rec);
    const have = rec.community;
    el.innerHTML = `
      <h3>Value</h3>
      ${est != null ? `<p class="bignum">${esc(M.money(est, cur))}</p><p class="meta">${m.suggestions ? `Discogs suggestion for ${esc(rec.mediaGrade || 'VG+')}` : 'Cheapest copy for sale now'}</p>` : `<p class="muted">${m.updated ? 'Discogs has no price for this one.' : 'No price yet.'}</p>`}
      ${m.suggestions ? `<div class="sug">${M.GRADES.filter((g) => m.suggestions[g.code] != null).map((g) => `<div class="${g.code === (rec.mediaGrade || 'VG+') ? 'me' : ''}"><span>${g.code}</span><b>${esc(M.money(m.suggestions[g.code], cur, m.suggestions[g.code] >= 100 ? 0 : 2))}</b></div>`).join('')}</div>` : ''}
      <dl class="facts">
        ${m.lowest != null ? `<div><dt>Cheapest for sale</dt><dd>${esc(M.money(m.lowest, cur))}${m.numForSale ? ` (${m.numForSale})` : ''}</dd></div>` : ''}
        ${have && have.have != null ? `<div><dt>Owned by</dt><dd>${have.have.toLocaleString('en-GB')}</dd></div><div><dt>Wanted by</dt><dd>${have.want.toLocaleString('en-GB')}</dd></div>` : ''}
        ${m.updated ? `<div><dt>Checked</dt><dd>${esc(M.ago(m.updated))}</dd></div>` : ''}
      </dl>
      <div class="row-btns">
        <button class="btn small" id="v-refresh">Refresh price</button>
        <a class="btn small" href="${M.discogsUrl(rec)}" target="_blank" rel="noopener">Sales history on Discogs ${icon('external', 14)}</a>
      </div>`;
    $('#v-refresh', el).onclick = async (e) => {
      e.currentTarget.disabled = true;
      e.currentTarget.textContent = 'Checking...';
      try { await refreshMarket(rec); } catch (err) { toast(describeError(err)); }
      drawValue();
    };
  }

  // ------------------------------------------------------ notes
  function drawNotes() {
    $('#r-notes', root).innerHTML = `<h3 class="sec">Notes</h3><textarea id="notes" rows="3" placeholder="Where you got it, pressing quirks, signed, anything">${esc(rec.notes)}</textarea>`;
    $('#notes', root).addEventListener('change', async (e) => {
      rec.notes = e.target.value.trim();
      touchGrades();
      await save();
      kick();
    });
  }

  // ------------------------------------------------------ listen
  function drawListen() {
    const el = $('#r-listen', root);
    const vids = M.uniqueVideos(rec.videos || []);
    if (!vids.length) {
      el.innerHTML = rec.source === 'discogs' && rec.detail && Array.isArray(rec.videos)
        ? '<h3 class="sec">Listen</h3><p class="muted">Discogs has no videos for this release.</p>' : '';
      return;
    }
    el.innerHTML = `<h3 class="sec">Listen</h3>
      <div class="rows">${vids.map((v) => `<button class="play-row" data-play="${esc(v.id)}"><span class="pi">${icon('play', 18)}</span><span class="pt">${esc(v.title)}</span><span class="pd">${esc(M.clock(v.duration))}</span></button>`).join('')}</div>
      <div id="player"></div>
      <p class="hint-text">Videos come from the Discogs page for this release. They may not be this exact pressing.</p>`;
    el.onclick = (e) => {
      const b = e.target.closest('[data-play]');
      if (!b) return;
      const box = $('#player', el);
      const id = b.dataset.play;
      const same = box.dataset.id === id;
      el.querySelectorAll('.play-row').forEach((r) => r.classList.toggle('on', !same && r === b));
      if (same) { box.innerHTML = ''; box.dataset.id = ''; return; }
      box.dataset.id = id;
      box.innerHTML = `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&autoplay=1" title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div><p class="hint-text"><a class="link" href="https://www.youtube.com/watch?v=${encodeURIComponent(id)}" target="_blank" rel="noopener">Open in YouTube ${icon('external', 13)}</a></p>`;
    };
  }

  // ------------------------------------------------------ tracks
  function spotifyMark(t) {
    const st = SP.loveStatus(rec, t);
    if (st === 'added') return `<span class="sp-ok" title="On Spotify">${icon('check', 15)}</span>`;
    if (st === 'miss') return `<span class="sp-miss" title="Not found on Spotify">${icon('close', 13)}</span>`;
    return '';
  }

  function drawTracks() {
    const el = $('#r-tracks', root);
    if (rec.tracklist && rec.tracklist.length) {
      el.innerHTML = `<h3 class="sec">Tracklist</h3><ol class="tracks">${rec.tracklist.map((t, i) => (t.heading ? `<li class="head">${esc(t.title)}</li>` : `<li><span class="pos">${esc(t.position)}</span><span class="tt">${esc(t.title)}</span><span class="dur">${esc(t.duration)}</span><span class="tbtns">${spotifyMark(t)}<button class="heart${M.isLoved(rec, t) ? ' on' : ''}" data-heart="${i}" aria-pressed="${M.isLoved(rec, t)}" aria-label="Love this track">${icon('heart', 18)}</button><button class="find-mix" data-find="${i}" aria-label="Find this track in mixes">${icon('search', 16)}</button><button class="add-mix" data-add="${i}" aria-label="Add to a mix">${icon('plus', 18)}</button></span></li>`)).join('')}</ol><p class="hint-text">Tap the heart on a track you love. Tap + to add it to a mix. Tap the magnifier to find it in DJ mixes.</p>`;
      el.onclick = async (e) => {
        const find = e.target.closest('[data-find]');
        if (find) return openFindInMixes(rec, rec.tracklist[Number(find.dataset.find)]);
        const add = e.target.closest('[data-add]');
        if (add) return openAddToMix(rec, rec.tracklist[Number(add.dataset.add)]);
        const h = e.target.closest('[data-heart]');
        if (!h) return;
        const key = M.trackKey(rec.tracklist[Number(h.dataset.heart)]);
        const set = new Set(rec.loved || []);
        if (set.has(key)) set.delete(key); else set.add(key);
        rec.loved = [...set];
        const on = set.has(key);
        h.classList.toggle('on', on);
        h.setAttribute('aria-pressed', String(on));
        drawLove();
        await save();
        if (on) SP.enqueueLove(rec, rec.tracklist[Number(h.dataset.heart)]);
      };
    } else if (rec.source === 'discogs' && !rec.detail) {
      el.innerHTML = `<h3 class="sec">Tracklist</h3><p class="muted" id="tl-state">Loading...</p>`;
    } else {
      el.innerHTML = '';
    }
  }

  // ------------------------------------------------------ details
  function drawDetails() {
    const rows = [];
    const add = (k, v) => { if (v) rows.push(`<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`); };
    add('Label', esc(rec.label));
    add('Catalogue number', esc(rec.catno));
    add('Country', esc(rec.country));
    add('Released', esc(rec.released || rec.year));
    add('Format', esc(rec.formatText));
    add('Genre', esc((rec.genres || []).join(', ')));
    add('Style', esc((rec.styles || []).join(', ')));
    add('Barcode', esc(rec.barcode));
    const mx = (rec.identifiers || []).filter((i) => i.type === 'Matrix / Runout').slice(0, 6);
    if (mx.length) add('Runout etchings', mx.map((i) => `${esc(i.value)}${i.description ? ` <span class="muted">${esc(i.description)}</span>` : ''}`).join('<br>'));
    add('Added', esc(M.dateStr(rec.added)));
    if (rec.releaseId) add('Discogs', `<a class="link" href="${M.discogsUrl(rec)}" target="_blank" rel="noopener">Release ${rec.releaseId} ${icon('external', 13)}</a>`);
    if (rec.instanceId) add('In your collection', 'Yes');
    else if (rec.source === 'discogs' && rec.noCollection && rec.status !== 'sold') add('In your collection', `No${rec.syncNote ? ' (' + esc(rec.syncNote) + ')' : ''}`);
    $('#r-details', root).innerHTML = `<h3 class="sec">Pressing details</h3><dl class="facts wide">${rows.join('')}</dl>${rec.releaseNotes ? `<details class="guide"><summary>Notes from Discogs</summary><p class="pre muted">${esc(rec.releaseNotes)}</p></details>` : ''}`;
  }

  // ------------------------------------------------------ actions
  function drawActions() {
    const el = $('#r-actions', root);
    el.innerHTML = `<div class="stack">
      ${rec.status === 'keeping' && !rec.wanted ? '<button class="btn" id="a-sell">Sell this record</button>' : ''}
      ${rec.source === 'manual' ? '<button class="btn primary" id="a-match">Match on Discogs</button>' : ''}
      ${rec.source === 'discogs' && rec.masterId ? '<button class="btn" id="a-press">Change pressing</button>' : ''}
      <button class="btn ghost danger-text" id="a-delete">Delete record</button>
    </div>`;
    const on = (sel, fn) => { const b = $(sel, el); if (b) b.onclick = fn; };
    on('#a-sell', () => openSellSheet(rec, redrawAll));
    on('#a-match', () => { location.hash = `#/scan/search/${rec.id}`; });
    on('#a-press', () => {
      const shell = { releaseId: rec.releaseId, masterId: rec.masterId, artist: rec.artist, title: rec.title, label: rec.label, catno: rec.catno, country: rec.country, year: rec.year, formatTags: rec.formatTags, formatText: rec.formatText, genres: rec.genres, styles: rec.styles, thumb: rec.thumb, cover: rec.cover };
      const s = openMatchSheet({ cands: [shell], changeFor: rec, onClose: () => setTimeout(redrawAll, 300) });
      s.el.querySelector('#m-press').click();
    });
    on('#a-delete', async () => {
      const extra = [];
      if (rec.instanceId) extra.push('It is also removed from your Discogs collection.');
      if (rec.listingId && (rec.listingStatus === 'For Sale' || rec.listingStatus === 'Draft')) extra.push('Its Discogs listing is deleted.');
      const ok = await confirmSheet({ title: 'Delete this record?', text: `${rec.artist}, ${rec.title}\n\n${extra.join(' ')}`.trim(), yes: 'Delete', danger: true });
      if (!ok) return;
      try {
        if (rec.listingId && (rec.listingStatus === 'For Sale' || rec.listingStatus === 'Draft')) await deleteListing(rec);
        if (rec.instanceId) await removeFromCollection(rec);
        if (rec.wanted) await removeWanted(rec);
      } catch (e) {
        toast(`${describeError(e)} Nothing was deleted.`);
        return;
      }
      if (state.records.has(rec.id)) await deleteRecord(rec.id);
      toast('Deleted');
      location.hash = rec.wanted ? '#/wanted' : '#/library';
    });
  }

  function redrawAll() {
    drawGallery(); drawHead(); drawStatus(); drawCond(); drawValue(); drawNotes(); drawListen(); drawTracks(); drawDetails(); drawActions();
  }
  redrawAll();

  $('#r-status', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (b) setStatus(b.dataset.st);
  });

  // Fetch the full details and a first price in the background of viewing this record.
  let alive = true;
  (async () => {
    try {
      if (rec.source === 'discogs' && rec.releaseId && !(rec.detail && Array.isArray(rec.videos))) {
        await ensureDetail(rec);
        if (!alive) return;
        drawGallery(); drawHead(); drawListen(); drawTracks(); drawDetails(); drawValue();
      }
      if (rec.source === 'discogs' && rec.releaseId && !(rec.market && rec.market.updated)) {
        await refreshMarket(rec);
        if (alive) drawValue();
      }
    } catch (e) {
      const t = $('#tl-state', root);
      if (t) t.textContent = describeError(e);
    }
  })();

  const offSpotify = subscribe((k) => { if (k === 'spotify') drawTracks(); });
  return () => { alive = false; offSpotify(); };
}
