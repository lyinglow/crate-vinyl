// Selling: the sheet to price and list a record, the "sold" sheet, and the Selling tab.
import { state, saveRecord, subscribe } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { refreshMarket, checkListings, removeFromCollection, deleteListing, kick } from '../sync.js';
import { esc, cover, icon, openSheet, confirmSheet, toast, chipRow, bindChips, describeError, hydratePhotos, $ } from '../ui.js';

const listingUrl = (id) => `https://www.discogs.com/sell/item/${id}`;
const CODES = M.GRADES.map((g) => g.code);
const parsePrice = (s) => {
  const n = parseFloat(String(s).replace(/[^\d.,]/g, '').replace(',', '.'));
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

function curOf(rec) {
  return (rec.market && rec.market.currency) || state.settings.currency;
}

// ------------------------------------------------------------ sell sheet

export function openSellSheet(rec, onDone) {
  const live = rec.listingId && (rec.listingStatus === 'For Sale' || rec.listingStatus === 'Draft');
  if (live) return openListedSheet(rec, onDone);

  const hasRelease = !!rec.releaseId;
  let media = rec.mediaGrade || state.settings.mediaGrade || 'VG+';
  let sleeve = rec.sleeveGrade || state.settings.sleeveGrade || 'VG+';
  if (!CODES.includes(sleeve)) sleeve = 'VG+';

  const s = openSheet({
    title: 'Sell this record',
    className: 'sell',
    body: `
      <div class="sell-head"><div class="vthumb">${cover(rec, { small: true })}</div><div><b>${esc(rec.artist)}</b><span>${esc(rec.title)}</span></div></div>
      ${hasRelease ? '<div class="card" id="guide"><p class="muted">Asking Discogs for prices...</p></div>' : '<p class="note">This record is not matched to Discogs yet, so there are no guide prices and it cannot be listed there. You can still mark it for sale here.</p>'}
      <label class="field"><span>Your price</span><input id="price" inputmode="decimal" placeholder="0.00" autocomplete="off"></label>
      <div class="chips" id="quick"></div>
      <div class="field"><span>Record condition</span>${chipRow(CODES, media, { attr: 'id="g-media"' })}</div>
      <div class="field"><span>Sleeve condition</span>${chipRow(CODES, sleeve, { attr: 'id="g-sleeve"' })}</div>
      <label class="field"><span>Note for the buyer</span><textarea id="comments" rows="2" placeholder="Optional">${esc(rec.sellNotes || '')}</textarea></label>
      <label class="check"><input type="checkbox" id="offers" checked> Allow offers</label>
      <div class="stack">
        ${hasRelease ? '<button class="btn primary" id="go-live">List on Discogs</button><button class="btn" id="go-draft">Save as a draft on Discogs</button>' : ''}
        <button class="btn${hasRelease ? ' ghost' : ' primary'}" id="go-local">Mark for sale here only</button>
      </div>
      ${hasRelease ? '<p class="hint-text">Listing on Discogs needs a seller account with your payment and shipping set up. Discogs takes a fee when it sells.</p>' : ''}`,
  });
  const el = s.el;
  const price = el.querySelector('#price');
  if (rec.askPrice) price.value = rec.askPrice;

  bindChips(el.querySelector('#g-media'), (c) => { if (c) { media = c; drawGuide(); } });
  bindChips(el.querySelector('#g-sleeve'), (c) => { if (c) sleeve = c; });

  function drawGuide() {
    const quick = el.querySelector('#quick');
    const m = rec.market || {};
    const cur = curOf(rec);
    const sug = m.suggestions && m.suggestions[media];
    const picks = [];
    if (sug != null) picks.push([`Suggested ${M.money(sug, cur)}`, sug]);
    if (m.lowest != null) picks.push([`Lowest now ${M.money(m.lowest, cur)}`, m.lowest]);
    quick.innerHTML = picks.map(([l, v]) => `<button type="button" class="chip" data-v="${v}">${esc(l)}</button>`).join('');
    const g = el.querySelector('#guide');
    if (!g) return;
    let h = '';
    if (m.suggestions) {
      h += `<div class="sug">${M.GRADES.filter((x) => m.suggestions[x.code] != null).map((x) => `<div class="${x.code === media ? 'me' : ''}"><span>${x.code}</span><b>${esc(M.money(m.suggestions[x.code], cur))}</b></div>`).join('')}</div><p class="muted">Discogs price suggestions by condition.</p>`;
    } else if (state.settings.sellerBlocked) {
      h += '<p class="muted">Discogs shares price suggestions once your seller settings are complete on discogs.com.</p>';
    }
    if (m.lowest != null) h += `<p>Cheapest copy for sale now: <b>${esc(M.money(m.lowest, cur))}</b>${m.numForSale ? ` <span class="muted">(${m.numForSale} for sale)</span>` : ''}</p>`;
    else if (m.numForSale === 0) h += '<p>None for sale on Discogs right now.</p>';
    h += `<p><a class="link" href="${M.discogsUrl(rec)}" target="_blank" rel="noopener">Last sold, median and high on Discogs ${icon('external', 14)}</a></p>`;
    g.innerHTML = h;
  }
  const firstGuess = () => {
    const m = rec.market || {};
    const g = (m.suggestions && m.suggestions[media]) ?? m.lowest;
    return g != null ? Number(g).toFixed(2) : '';
  };
  drawGuide();
  if (!price.value) price.value = firstGuess();
  el.querySelector('#quick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) price.value = Number(b.dataset.v).toFixed(2);
  });

  if (hasRelease) {
    refreshMarket(rec).then(() => {
      if (!price.value) price.value = firstGuess();
      drawGuide();
    }).catch((e) => {
      const g = el.querySelector('#guide');
      if (g) g.innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
    });
  }

  async function apply(patch) {
    Object.assign(rec, patch, { status: 'for_sale', mediaGrade: media, sleeveGrade: sleeve, sellNotes: el.querySelector('#comments').value.trim() });
    if (rec.instanceId) rec.fieldsDirty = true;
    await saveRecord(rec);
    kick();
  }

  async function listOnDiscogs(statusText) {
    const p = parsePrice(price.value);
    if (!p) { toast('Add a price first.'); return; }
    if (statusText === 'For Sale') {
      const ok = await confirmSheet({
        title: 'List on Discogs?',
        text: `${rec.artist}, ${rec.title}\n${M.money(p, curOf(rec))}, ${media} / ${sleeve}\n\nIt goes live on Discogs straight away.`,
        yes: 'List it now',
        no: 'Not yet',
      });
      if (!ok) return;
    }
    const buttons = el.querySelectorAll('.stack .btn');
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const res = await D.listingCreate({
        release_id: rec.releaseId,
        condition: M.gradeName(media),
        sleeve_condition: M.gradeName(sleeve),
        price: p,
        comments: el.querySelector('#comments').value.trim(),
        allow_offers: el.querySelector('#offers').checked,
        status: statusText,
      });
      await apply({ askPrice: p, listingId: res.listing_id, listingStatus: statusText, listedAt: Date.now() });
      s.close();
      toast(statusText === 'Draft' ? 'Saved as a draft on Discogs' : 'Listed on Discogs');
      if (onDone) onDone();
    } catch (e) {
      toast(describeError(e), { ms: 7000 });
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  const live1 = el.querySelector('#go-live');
  if (live1) live1.onclick = () => listOnDiscogs('For Sale');
  const draft = el.querySelector('#go-draft');
  if (draft) draft.onclick = () => listOnDiscogs('Draft');
  el.querySelector('#go-local').onclick = async () => {
    const p = parsePrice(price.value);
    if (!p) { toast('Add a price first.'); return; }
    await apply({ askPrice: p, listedAt: rec.listedAt || Date.now() });
    s.close();
    toast('Marked for sale');
    if (onDone) onDone();
  };
}

function openListedSheet(rec, onDone) {
  const cur = curOf(rec);
  const s = openSheet({
    title: rec.listingStatus === 'Draft' ? 'Draft on Discogs' : 'Listed on Discogs',
    body: `
      <div class="sell-head"><div class="vthumb">${cover(rec, { small: true })}</div><div><b>${esc(rec.artist)}</b><span>${esc(rec.title)}</span></div></div>
      <p>Asking <b>${esc(M.money(rec.askPrice, cur))}</b>${rec.listedAt ? `, listed ${esc(M.ago(rec.listedAt))}` : ''}.</p>
      <p class="muted">To change the price or publish a draft, edit the listing on Discogs. Then tap Check Discogs on the Selling tab.</p>
      <div class="stack">
        <a class="btn primary" href="${listingUrl(rec.listingId)}" target="_blank" rel="noopener">Open the listing on Discogs</a>
        <button class="btn" id="sold">Mark as sold</button>
        <button class="btn ghost danger-text" id="remove">Take it off sale</button>
      </div>`,
  });
  s.el.querySelector('#sold').onclick = () => { s.close(); openSoldSheet(rec, onDone); };
  s.el.querySelector('#remove').onclick = async () => {
    const ok = await confirmSheet({ title: 'Take it off sale?', text: 'The Discogs listing is deleted and the record goes back to Keeping.', yes: 'Take it off sale', danger: true });
    if (!ok) return;
    try {
      await deleteListing(rec);
      Object.assign(rec, { status: 'keeping', listingId: null, listingStatus: '', askPrice: null });
      rec.noCollection = false;
      await saveRecord(rec);
      kick();
      s.close();
      toast('Back to Keeping');
      if (onDone) onDone();
    } catch (e) { toast(describeError(e)); }
  };
}

// ------------------------------------------------------------ sold sheet

export function openSoldSheet(rec, onDone) {
  const hasListing = rec.listingId && rec.listingStatus !== 'Sold' && rec.listingStatus !== 'Deleted';
  const s = openSheet({
    title: 'Mark as sold',
    body: `
      <div class="sell-head"><div class="vthumb">${cover(rec, { small: true })}</div><div><b>${esc(rec.artist)}</b><span>${esc(rec.title)}</span></div></div>
      <label class="field"><span>Sold for</span><input id="sold-price" inputmode="decimal" value="${rec.askPrice || ''}" placeholder="0.00"></label>
      ${rec.instanceId ? '<label class="check"><input type="checkbox" id="rm-coll" checked> Remove it from my Discogs collection</label>' : ''}
      ${hasListing ? '<label class="check"><input type="checkbox" id="rm-list" checked> Delete the Discogs listing</label>' : ''}
      <div class="stack"><button class="btn primary" id="ok">Mark as sold</button><button class="btn ghost" id="no">Cancel</button></div>`,
  });
  s.el.querySelector('#no').onclick = () => s.close();
  s.el.querySelector('#ok').onclick = async () => {
    const p = parsePrice(s.el.querySelector('#sold-price').value);
    const btn = s.el.querySelector('#ok');
    btn.disabled = true;
    try {
      const rl = s.el.querySelector('#rm-list');
      if (rl && rl.checked) await deleteListing(rec);
      Object.assign(rec, { status: 'sold', soldAt: Date.now(), soldPrice: p || rec.askPrice || null });
      if (rl && rl.checked) rec.listingStatus = 'Deleted';
      await saveRecord(rec);
      const rc = s.el.querySelector('#rm-coll');
      if (rc && rc.checked) await removeFromCollection(rec);
      s.close();
      toast('Marked as sold');
      if (onDone) onDone();
    } catch (e) {
      toast(describeError(e));
      btn.disabled = false;
    }
  };
}

// ------------------------------------------------------------ Selling tab

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <div class="largetitle"><h1>Selling</h1><p class="sub" id="sell-sub"></p></div>
      <div id="sell-top"></div>
      <div id="sell-body"></div>
    </div>`;

  function row(r, kind) {
    const cur = curOf(r);
    let right = '';
    let sub = [r.mediaGrade && `${r.mediaGrade}${r.sleeveGrade ? ' / ' + r.sleeveGrade : ''}`].filter(Boolean).join(' · ');
    if (kind === 'ready') right = `<b>${esc(M.money(r.askPrice, cur))}</b><button class="btn small" data-sell="${r.id}">List</button>`;
    if (kind === 'listed') right = `<b>${esc(M.money(r.askPrice, cur))}</b><small class="pill ${r.listingStatus === 'Draft' ? '' : 'live'}">${esc(r.listingStatus || 'For Sale')}</small>`;
    if (kind === 'sold') { right = `<b>${esc(M.money(r.soldPrice, cur))}</b><small>${esc(M.dateStr(r.soldAt))}</small>`; }
    return `<div class="lrow" data-go="${r.id}">
      <div class="lthumb">${cover(r, { small: true })}</div>
      <div class="ltext"><b>${esc(r.artist)}</b><span>${esc(r.title)}</span><small>${esc(sub)}</small></div>
      <div class="lright">${right}</div></div>`;
  }

  function draw() {
    const all = [...state.records.values()].filter((r) => !r.wanted);
    const ready = all.filter((r) => r.status === 'for_sale' && !r.listingId);
    const listed = all.filter((r) => r.status === 'for_sale' && r.listingId);
    const sold = all.filter((r) => r.status === 'sold').sort((a, b) => (b.soldAt || 0) - (a.soldAt || 0));
    const cur = state.settings.currency;
    const revenue = sold.reduce((t, r) => t + (r.soldPrice || 0), 0);
    const asking = ready.concat(listed).reduce((t, r) => t + (r.askPrice || 0), 0);
    $('#sell-sub', root).textContent = `${listed.length} listed · ${ready.length} ready · ${sold.length} sold`;

    const needRemove = all.filter((r) => r.needsCollRemoval && r.instanceId);
    $('#sell-top', root).innerHTML = `
      <div class="stats">
        <div><span>Asking</span><b>${esc(M.money(asking, cur))}</b></div>
        <div><span>Sold so far</span><b>${esc(M.money(revenue, cur))}</b></div>
      </div>
      <button class="btn" id="check">Check Discogs for sales</button>
      ${needRemove.length ? `<div class="banner">${needRemove.length} sold record${needRemove.length > 1 ? 's are' : ' is'} still in your Discogs collection. <button class="link" id="rm-all">Remove</button></div>` : ''}`;

    const sec = (title, arr, kind) => (arr.length ? `<h3 class="sec">${title}</h3><div class="rows">${arr.map((r) => row(r, kind)).join('')}</div>` : '');
    $('#sell-body', root).innerHTML = (ready.length || listed.length || sold.length)
      ? sec('Ready to list', ready, 'ready') + sec('On Discogs', listed, 'listed') + sec('Sold', sold, 'sold')
      : `<div class="empty small"><p>Nothing for sale yet. Open a record and choose For sale, or look at the Value tab for ideas.</p><a class="btn small" href="#/value">See what is worth selling</a></div>`;
    hydratePhotos(root);

    const chk = $('#check', root);
    chk.onclick = async () => {
      chk.disabled = true;
      chk.textContent = 'Checking...';
      try {
        const r = await checkListings();
        toast(r.checked ? `Checked ${r.checked}. ${r.sold} sold, ${r.changed} changed.` : 'Nothing is listed on Discogs yet.');
      } catch (e) { toast(describeError(e)); }
      draw();
    };
    const rm = $('#rm-all', root);
    if (rm) rm.onclick = async () => {
      rm.disabled = true;
      try { for (const r of needRemove) await removeFromCollection(r); toast('Removed from your Discogs collection'); } catch (e) { toast(describeError(e)); }
      draw();
    };
  }
  draw();

  root.addEventListener('click', (e) => {
    const sell = e.target.closest('[data-sell]');
    if (sell) { e.stopPropagation(); openSellSheet(state.records.get(sell.dataset.sell), draw); return; }
    const go = e.target.closest('[data-go]');
    if (go) location.hash = `#/record/${go.dataset.go}`;
  });

  const off = subscribe((k) => { if (k === 'records') draw(); });
  return off;
}
