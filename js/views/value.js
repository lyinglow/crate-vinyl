// Value: what the collection is worth, the most valuable records, and records worth selling.
import { state, saveRecord, saveSettings, subscribe } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { kick, pendingPrices, status as syncStatus } from '../sync.js';
import { esc, cover, icon, toast, hydratePhotos, describeError, $ } from '../ui.js';
import { openSellSheet } from './sell.js';
import { takeSnapshot, series } from '../history.js';

let topShown = 10;
let showHidden = false;
let chartDays = 90;

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <div class="largetitle"><h1>Value</h1><p class="sub" id="v-sub"></p></div>
      <section class="card hero" id="v-total"></section>
      <section class="card" id="v-pl"></section>
      <section class="card" id="v-chart"></section>
      <a class="card flat linkcard" href="#/stats"><span><b>Collection stats</b><br><span class="muted">By decade, year, label and value</span></span>${icon('chevron', 18)}</a>
      <section id="v-discogs"></section>
      <h3 class="sec">Movers</h3>
      <p class="muted">Records whose price moved most in the last 30 days.</p>
      <div id="v-movers"></div>
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
    const owned = [...state.records.values()].filter((r) => r.status !== 'sold' && !r.wanted);
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

    const rowHtml = (r, extra = '') => {
      const c = (r.market && r.market.currency) || cur;
      return `<div class="lrow" data-go="${r.id}">
        <div class="lthumb">${cover(r, { small: true })}</div>
        <div class="ltext"><b>${esc(r.artist)}</b><span>${esc(r.title)}</span><small>${esc([r.year, r.mediaGrade, wanted(r)].filter(Boolean).join(' · '))}</small></div>
        <div class="lright"><b>${esc(money(M.estimate(r), c))}</b>${extra}</div></div>`;
    };
    // ---- profit and loss
    const hasPaid = (r) => r.paid != null && r.paid !== '' && isFinite(Number(r.paid));
    const paidRecs = owned.filter(hasPaid);
    const both = paidRecs.filter((r) => M.estimate(r) != null);
    const paidSum = both.reduce((t, r) => t + Number(r.paid), 0);
    const nowSum = both.reduce((t, r) => t + M.estimate(r), 0);
    const gainAmt = nowSum - paidSum;
    const sold = [...state.records.values()].filter((r) => !r.wanted && M.profit(r));
    const realised = sold.reduce((t, r) => t + M.profit(r).amount, 0);
    const spent = paidRecs.reduce((t, r) => t + Number(r.paid), 0);
    $('#v-pl', root).innerHTML = `<p class="meta">Profit and loss</p>
      ${both.length ? `<div class="stats three"><div><span>Paid</span><b>${esc(money(paidSum, cur, 0))}</b></div><div><span>Worth now</span><b>${esc(money(nowSum, cur, 0))}</b></div><div><span>${gainAmt >= 0 ? 'Gain' : 'Loss'}</span><b class="${gainAmt >= 0 ? 'upc' : 'downc'}">${esc(M.signed(gainAmt, cur, 0))}${paidSum > 0 ? ` (${esc(M.pctText(gainAmt / paidSum))})` : ''}</b></div></div>` : '<p class="muted">Add what you paid for your records and Crate shows what you have gained or lost.</p>'}
      ${sold.length ? `<p class="muted">Records you sold: <b class="${realised >= 0 ? 'upc' : 'downc'}">${esc(M.signed(realised, cur, 0))}</b> across ${sold.length}. Discogs fees are not counted.</p>` : ''}
      <p class="muted">${paidRecs.length.toLocaleString('en-GB')} of ${owned.length.toLocaleString('en-GB')} records have a price paid${spent ? `, ${esc(money(spent, cur, 0))} in all` : ''}. ${owned.length > paidRecs.length ? '<a class="link" href="#/paid">Fill in what you paid</a>' : ''}</p>`;

    // ---- over time
    takeSnapshot();
    const pts = series(chartDays);
    const rangeChips = [[30, '30 days'], [90, '3 months'], [365, 'A year']].map(([d, l]) => `<button type="button" class="chip${d === chartDays ? ' on' : ''}" data-days="${d}">${l}</button>`).join('');
    if (pts.length < 2) {
      $('#v-chart', root).innerHTML = `<p class="meta">Over time</p><p class="muted">A line appears here once Crate has seen your collection's value on two different days. Open the app now and then and it fills in by itself.</p>`;
    } else {
      const W = 300; const H = 96; const pad = 6;
      const vals = pts.map((p) => p.worth);
      const lo = Math.min(...vals); const hi = Math.max(...vals);
      const span = hi - lo || 1;
      const t0 = Date.parse(pts[0].d); const t1 = Date.parse(pts[pts.length - 1].d) || t0 + 1;
      const x = (p) => pad + ((Date.parse(p.d) - t0) / Math.max(1, t1 - t0)) * (W - pad * 2);
      const y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
      const line = pts.map((p) => `${x(p).toFixed(1)},${y(p.worth).toFixed(1)}`).join(' ');
      const first = pts[0]; const last = pts[pts.length - 1];
      const ch = last.worth - first.worth;
      $('#v-chart', root).innerHTML = `<p class="meta">Over time</p>
        <p class="bignum">${esc(money(last.worth, cur, 0))}</p>
        <p class="gainline ${ch >= 0 ? 'up' : 'down'}"><b>${esc(M.signed(ch, cur, 0))}</b>${first.worth > 0 ? ` (${esc(M.pctText(ch / first.worth))})` : ''} since ${esc(M.dateStr(Date.parse(first.d)))}</p>
        <svg class="vchart ${ch >= 0 ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Collection value over time"><polyline points="${pad},${H - pad} ${line} ${W - pad},${H - pad}" class="area"/><polyline points="${line}" class="ln"/></svg>
        <div class="chips">${rangeChips}</div>`;
    }
    if (pts.length < 2) $('#v-chart', root).insertAdjacentHTML('beforeend', `<div class="chips">${rangeChips}</div>`);

    // ---- movers
    const month = Date.now() - 30 * 864e5;
    const moved = owned.filter((r) => r.move && r.move.at >= month && r.move.to !== r.move.from).map((r) => ({ r, d: r.move.to - r.move.from }));
    const ups = moved.filter((m) => m.d > 0).sort((a, b) => b.d - a.d).slice(0, 5);
    const downs = moved.filter((m) => m.d < 0).sort((a, b) => a.d - b.d).slice(0, 5);
    const mv = (m) => rowHtml(m.r, `<small class="${m.d > 0 ? 'upc' : 'downc'}">${esc(M.signed(m.d, (m.r.market && m.r.market.currency) || cur))}</small>`);
    $('#v-movers', root).innerHTML = moved.length
      ? `${ups.length ? `<p class="meta">Up</p><div class="rows">${ups.map(mv).join('')}</div>` : ''}${downs.length ? `<p class="meta">Down</p><div class="rows">${downs.map(mv).join('')}</div>` : ''}`
      : '<p class="muted">Nothing has moved yet. Prices are checked again every few days, and the biggest changes show here.</p>';

    // ---- top records
    const top = priced.slice().sort((a, b) => M.estimate(b) - M.estimate(a));
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
    const days = e.target.closest('[data-days]');
    if (days) { chartDays = Number(days.dataset.days); draw(); return; }
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
