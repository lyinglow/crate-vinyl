// Value: what the collection is worth, the most valuable records, and records worth selling.
import { state, saveRecord, saveSettings, subscribe } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { kick, pendingPrices, status as syncStatus } from '../sync.js';
import { esc, cover, icon, toast, hydratePhotos, describeError, $ } from '../ui.js';
import { openSellSheet } from './sell.js';

let topShown = 10;
let showHidden = false;

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <div class="largetitle"><h1>Value</h1><p class="sub" id="v-sub"></p></div>
      <section class="card hero" id="v-total"></section>
      <section id="v-discogs"></section>
      <h3 class="sec">Most valuable</h3>
      <div id="v-top"></div>
      <h3 class="sec">Worth selling</h3>
      <p class="muted">Records you are keeping that are worth a lot. Tap Keep on the ones you will never sell. Tap Sell on the ones you could let go.</p>
      <div class="chips" id="v-min"></div>
      <div id="v-worth"></div>
    </div>`;

  function money(n, cur, d) { return M.money(n, cur, d); }

  function draw() {
    const cur = state.settings.currency;
    const owned = [...state.records.values()].filter((r) => r.status !== 'sold');
    const priced = owned.filter((r) => M.estimate(r) != null);
    const total = priced.reduce((t, r) => t + M.estimate(r), 0);
    const missing = pendingPrices();
    const minutes = Math.ceil(missing / 54);
    $('#v-sub', root).textContent = owned.length ? `${priced.length.toLocaleString('en-GB')} of ${owned.length.toLocaleString('en-GB')} records priced` : '';

    // ---- total
    let note = '';
    if (!owned.length) note = '<p class="muted">Add records and their value shows here.</p>';
    else if (state.settings.sellerBlocked) note = '<p class="muted">Using the cheapest price for sale. For better figures, complete your seller settings on discogs.com. Discogs then shares price suggestions for each condition.</p>';
    else note = '<p class="muted">Based on Discogs price suggestions for the condition you graded each record.</p>';
    $('#v-total', root).innerHTML = `
      <p class="meta">Collection value</p>
      <p class="bignum xl">${esc(money(total, cur, 0))}</p>
      ${note}
      ${missing ? `<div class="progress"><p><b>${missing.toLocaleString('en-GB')}</b> records still need a price. About ${minutes} minute${minutes === 1 ? '' : 's'}.</p>
        ${syncStatus.running ? '<p class="muted">Working on it. Keep the app open.</p>' : '<button class="btn primary" id="get-prices">Get prices now</button>'}</div>` : ''}`;
    const gp = $('#get-prices', root);
    if (gp) gp.onclick = async () => { await saveSettings({ fetchPrices: true }); kick(); draw(); };

    // ---- Discogs' own figure
    const cv = state.settings.collectionValue;
    $('#v-discogs', root).innerHTML = state.settings.username ? `
      <div class="card flat">
        ${cv ? `<p class="meta">Discogs' own figure for your collection (${esc(M.ago(cv.at))})</p>
          <div class="stats three"><div><span>Low</span><b>${esc(cv.min)}</b></div><div><span>Middle</span><b>${esc(cv.median)}</b></div><div><span>High</span><b>${esc(cv.max)}</b></div></div>` : '<p class="muted">You can also ask Discogs for its own low, middle and high figures. They count records in your Discogs collection.</p>'}
        <button class="btn small" id="ask">${cv ? 'Ask again' : 'Ask Discogs'}</button>
      </div>` : '';
    const ask = $('#ask', root);
    if (ask) ask.onclick = async () => {
      ask.disabled = true;
      ask.textContent = 'Asking...';
      try {
        const r = await D.collectionValue(state.settings.username);
        await saveSettings({ collectionValue: { min: r.minimum, median: r.median, max: r.maximum, at: Date.now() } });
      } catch (e) { toast(describeError(e)); }
      draw();
    };

    // ---- top records
    const top = priced.slice().sort((a, b) => M.estimate(b) - M.estimate(a));
    const rowHtml = (r, extra = '') => {
      const c = (r.market && r.market.currency) || cur;
      return `<div class="lrow" data-go="${r.id}">
        <div class="lthumb">${cover(r, { small: true })}</div>
        <div class="ltext"><b>${esc(r.artist)}</b><span>${esc(r.title)}</span><small>${esc([r.year, r.mediaGrade, wanted(r)].filter(Boolean).join(' · '))}</small></div>
        <div class="lright"><b>${esc(money(M.estimate(r), c))}</b>${extra}</div></div>`;
    };
    $('#v-top', root).innerHTML = top.length
      ? `<div class="rows">${top.slice(0, topShown).map((r) => rowHtml(r)).join('')}</div>${top.length > topShown ? '<button class="btn small" id="more-top">Show more</button>' : ''}`
      : '<p class="muted">No prices yet.</p>';
    const mt = $('#more-top', root);
    if (mt) mt.onclick = () => { topShown += 20; draw(); };

    // ---- worth selling
    const min = state.settings.worthMin;
    $('#v-min', root).innerHTML = [10, 20, 30, 50, 100].map((n) => `<button class="chip${n === min ? ' on' : ''}" data-min="${n}">${esc(money(n, cur, 0))}+</button>`).join('');
    const cands = top.filter((r) => r.status === 'keeping' && M.estimate(r) >= min);
    const live = cands.filter((r) => !r.keepForever);
    const hidden = cands.filter((r) => r.keepForever);
    const sum = live.reduce((t, r) => t + M.estimate(r), 0);
    const btns = (r) => `<div class="mini"><button class="btn small" data-keep="${r.id}">${r.keepForever ? 'Undo' : 'Keep'}</button>${r.keepForever ? '' : `<button class="btn small primary" data-sell="${r.id}">Sell</button>`}</div>`;
    $('#v-worth', root).innerHTML = (live.length
      ? `<p class="meta">${live.length} record${live.length > 1 ? 's' : ''}, about ${esc(money(sum, cur, 0))} together</p><div class="rows">${live.slice(0, 60).map((r) => rowHtml(r, btns(r))).join('')}</div>${live.length > 60 ? `<p class="muted">Showing the 60 most valuable.</p>` : ''}`
      : '<p class="muted">Nothing at this price.</p>')
      + (hidden.length ? `<button class="link" id="toggle-hidden">${showHidden ? 'Hide' : 'Show'} ${hidden.length} marked Keep</button>${showHidden ? `<div class="rows">${hidden.map((r) => rowHtml(r, btns(r))).join('')}</div>` : ''}` : '');
    hydratePhotos(root);
    const th = $('#toggle-hidden', root);
    if (th) th.onclick = () => { showHidden = !showHidden; draw(); };
  }

  function wanted(r) {
    const c = r.community;
    return c && c.want ? `wanted by ${c.want.toLocaleString('en-GB')}` : '';
  }

  draw();

  root.addEventListener('click', async (e) => {
    const min = e.target.closest('[data-min]');
    if (min) { await saveSettings({ worthMin: Number(min.dataset.min) }); draw(); return; }
    const keep = e.target.closest('[data-keep]');
    if (keep) {
      const r = state.records.get(keep.dataset.keep);
      r.keepForever = !r.keepForever;
      await saveRecord(r, { quiet: true });
      draw();
      return;
    }
    const sell = e.target.closest('[data-sell]');
    if (sell) { openSellSheet(state.records.get(sell.dataset.sell), draw); return; }
    const go = e.target.closest('[data-go]');
    if (go) location.hash = `#/record/${go.dataset.go}`;
  });

  // refresh totals now and then while prices are coming in
  let t = null;
  const off = subscribe((k) => {
    if (k === 'sync' || k === 'quiet' || k === 'records') {
      if (t) return;
      t = setTimeout(() => { t = null; draw(); }, 4000);
    }
  });
  return () => { off(); clearTimeout(t); };
}
