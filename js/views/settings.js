// Settings and the welcome screen: connect Discogs, import, defaults, backup.
import { spinNow } from './carousel.js';
import { state, saveSettings, wipeAll, subscribe } from '../store.js';
import * as M from '../model.js';
import { D } from '../discogs.js';
import { importCollection, refreshAllPrices, kick, pendingPrices } from '../sync.js';
import { exportCsv, exportBackup, restoreBackup } from '../exporter.js';
import * as SP from '../spotify.js';
import { lovedCount } from './loved.js';
import { esc, icon, toast, confirmSheet, chipRow, bindChips, describeError, $ } from '../ui.js';

const CODES = M.GRADES.map((g) => g.code);

async function connect(token) {
  await saveSettings({ token: token.trim(), username: '' });
  try {
    const me = await D.identity();
    let currency = state.settings.currency;
    try {
      const u = await D.user(me.username);
      if (u && u.curr_abbr) currency = u.curr_abbr;
    } catch { /* keep the old currency */ }
    await saveSettings({ username: me.username, currency, fieldMap: null, sellerBlocked: false });
    return me.username;
  } catch (e) {
    await saveSettings({ token: '', username: '' });
    throw e;
  }
}

function tokenForm() {
  return `<form id="tf" class="form">
    <ol class="steps">
      <li>Sign in at <a class="link" href="https://www.discogs.com/settings/developers" target="_blank" rel="noopener">discogs.com/settings/developers</a>.</li>
      <li>Tap <b>Generate new token</b>.</li>
      <li>Copy the long code and paste it below.</li>
    </ol>
    <label class="field"><span>Your Discogs token</span><input name="token" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste it here" required></label>
    <button class="btn primary" type="submit">Connect</button>
    <p class="hint-text">The token stays on this phone. It lets this app act as you on Discogs, so keep it private. You can make a new one at any time to cancel the old one.</p>
  </form>`;
}

function bindTokenForm(root, done) {
  const form = $('#tf', root);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Connecting...';
    try {
      const name = await connect(new FormData(form).get('token'));
      toast(`Connected as ${name}`);
      done(name);
    } catch (err) {
      toast(err.status === 401 ? 'Discogs did not accept that token. Check you copied all of it.' : describeError(err), { ms: 6000 });
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  };
}

// ---------------------------------------------------------------- welcome

export function mountWelcome(root) {
  function draw() {
    const connected = !!state.settings.username;
    root.innerHTML = `
      <div class="page welcome">
        <div class="disc big"></div>
        <h1>Crate</h1>
        <p class="lead">Your records, as sleeves. Scan to add. Linked to Discogs.</p>
        ${connected ? `
          <div class="card"><p>Connected as <b>${esc(state.settings.username)}</b>.</p></div>
          <div class="stack">
            <button class="btn primary" id="imp">Import my Discogs collection</button>
            <a class="btn" href="#/scan">Start scanning</a>
            <a class="btn ghost" href="#/library">Go to my library</a>
          </div>
          <p class="hint-text" id="imp-state">If you already keep a collection on Discogs, import it first. Then you only scan what is new.</p>`
          : tokenForm()}
      </div>`;
    if (!connected) bindTokenForm(root, draw);
    else $('#imp', root).onclick = () => runImport($('#imp', root), $('#imp-state', root));
  }
  draw();
}

async function runImport(btn, stateEl) {
  btn.disabled = true;
  try {
    const r = await importCollection((p) => {
      const msg = `Page ${p.page} of ${p.pages}. ${p.added.toLocaleString('en-GB')} records so far.`;
      btn.textContent = msg;
      if (stateEl) stateEl.textContent = msg;
    });
    toast(`Imported ${r.added.toLocaleString('en-GB')} records`);
    btn.textContent = 'Done. Import again';
    if (stateEl) stateEl.textContent = `Imported ${r.added.toLocaleString('en-GB')} records. Prices are being fetched in the background. Open the Library to see your sleeves.`;
    kick();
  } catch (e) {
    toast(describeError(e));
    btn.textContent = 'Import my Discogs collection';
  }
  btn.disabled = false;
}

// ---------------------------------------------------------------- settings

function spotifyCard(s) {
  if (SP.connected()) {
    const pl = (s.spotifyPlaylists || {}).loved;
    return `<p>Connected as <b>${esc(s.spotify.name || 'Spotify')}</b></p>
      <label class="switch"><input type="checkbox" id="sp-all" ${s.spotifyAll !== false ? 'checked' : ''}><span>Add every track of each record I add to "${esc(SP.ALL_NAME)}"</span></label>
      <label class="switch"><input type="checkbox" id="sp-auto" ${s.spotifyAuto !== false ? 'checked' : ''}><span>Add tracks I heart to "${esc(SP.LOVED_NAME)}"</span></label>
      <p class="muted" id="sp-state"></p>
      <div class="row-btns">
        <button class="btn small" id="sp-now">Add my loved tracks now (${lovedCount()})</button>
        <button class="btn small" id="sp-whole">Add my whole collection now</button>
      </div>
      <div class="row-btns">
        ${pl ? `<a class="btn small" href="${SP.playlistUrl(pl)}" target="_blank" rel="noopener">Open ${esc(SP.LOVED_NAME)}</a>` : ''}
        ${((s.spotifyPlaylists || {}).all || [])[0] ? `<a class="btn small" href="${SP.playlistUrl(s.spotifyPlaylists.all[0].id)}" target="_blank" rel="noopener">Open ${esc(SP.ALL_NAME)}</a>` : ''}
        <button class="btn small" id="sp-off">Disconnect</button>
      </div>`;
  }
  return `<label class="field"><span>Spotify Client ID</span><input id="sp-id" value="${esc(s.spotifyClientId || '')}" placeholder="32 letters and numbers" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
    <p class="hint-text" style="margin-top:0">In your Spotify developer app, add this Redirect URI exactly:<br><b id="sp-uri" style="word-break:break-all">${esc(SP.redirectUri())}</b></p>
    <button class="btn primary" id="sp-connect" style="margin-top:12px">Connect Spotify</button>
    <details class="guide" style="margin-top:10px"><summary>Came back from Spotify with a code?</summary>
      <form id="sp-form" style="margin-top:8px"><label class="field"><input id="sp-code" placeholder="Paste the code here" autocomplete="off" autocapitalize="off"></label><button class="btn small" type="submit">Use this code</button></form></details>`;
}

export function mount(root) {
  function draw() {
    const s = state.settings;
    const n = state.records.size;
    root.innerHTML = `
      <div class="page">
        <div class="largetitle"><h1>Settings</h1></div>

        <h3 class="sec">Discogs</h3>
        <div class="card">
          ${s.username ? `<p>Connected as <b>${esc(s.username)}</b></p><p class="muted">Prices shown in ${esc(s.currency)}. To change the currency, change it in your Discogs selling settings, then connect again.</p>
            <div class="row-btns"><button class="btn small" id="import">Import my Discogs collection</button><button class="btn small" id="disconnect">Disconnect</button></div>
            <p class="hint-text" id="import-state"></p>` : tokenForm()}
        </div>

        <h3 class="sec">Cover flow background</h3>
        <div class="card">
          <div class="chips" id="bg-chips">${[['soft', 'Soft gradient'], ['pixel', 'Pixels and grain'], ['off', 'Plain']].map(([k, l]) => `<button type="button" class="chip${(s.bgStyle || 'soft') === k ? ' on' : ''}" data-bg="${k}">${l}</button>`).join('')}</div>
          <p class="hint-text">Colour taken from the sleeves near the middle. Soft is a pale blend. Pixels is chunky with film grain. Plain turns it off.</p>
        </div>

        <h3 class="sec">Spin the sleeve</h3>
        <div class="card">
          <div class="chips" id="spin-chips">${[[0, 'Off'], [15, '15 seconds'], [30, '30 seconds'], [60, '1 minute'], [300, '5 minutes']].map(([k, l]) => `<button type="button" class="chip${Number(s.autoSpin ?? 30) === k ? ' on' : ''}" data-spin="${k}">${l}</button>`).join('')}</div>
          <div class="row-btns"><button type="button" class="btn small" id="spin-now">Spin now</button></div>
          <p class="hint-text">Leave the Library alone for this long and the sleeve in the middle gives itself a spin. Touch it to stop.</p>
          ${window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '<p class="hint-text">Your phone has Reduce Motion on, so Crate will not spin by itself. Turn it off in iPhone Settings, Accessibility, Motion. Spin now still works.</p>' : ''}
        </div>

        <h3 class="sec">Spotify</h3>
        <div class="card" id="sp-card">${spotifyCard(s)}</div>

        <h3 class="sec">When you add a record</h3>
        <div class="card">
          <div class="field"><span>Starting grade, record</span>${chipRow(CODES, s.mediaGrade, { attr: 'id="d-media"' })}</div>
          <div class="field"><span>Starting grade, sleeve</span>${chipRow(CODES, s.sleeveGrade, { attr: 'id="d-sleeve"' })}</div>
          <label class="switch"><input type="checkbox" id="t-coll" ${s.addToCollection ? 'checked' : ''}><span>Add it to my Discogs collection too</span></label>
          <label class="switch"><input type="checkbox" id="t-price" ${s.fetchPrices ? 'checked' : ''}><span>Look up prices in the background</span></label>
        </div>

        <h3 class="sec">Prices</h3>
        <div class="card">
          <p class="muted">${pendingPrices().toLocaleString('en-GB')} records need a price. Prices are checked again after 30 days.</p>
          <button class="btn small" id="reprice">Check every price again</button>
          <p class="hint-text">Discogs lets this app make about 54 requests a minute. 2,000 records take about 40 minutes. Keep the app open and the screen on. It remembers where it got to.</p>
        </div>

        <h3 class="sec">Your data</h3>
        <div class="card">
          <p class="muted">${n.toLocaleString('en-GB')} records on this phone. Last backup: ${esc(M.ago(s.lastBackup))}.</p>
          <div class="stack">
            <button class="btn" id="csv">Export to a spreadsheet (CSV)</button>
            <button class="btn" id="backup">Back up everything</button>
            <label class="btn file">Restore from a backup<input type="file" id="restore" accept="application/json,.json" hidden></label>
          </div>
          <p class="hint-text">${state.persisted ? 'This phone has agreed to keep your data.' : 'Add Crate to your Home Screen so iPhone keeps your data safe.'} Back up now and then. If you use the Discogs collection option, Discogs also holds a copy of your list.</p>
        </div>

        <h3 class="sec">Advanced</h3>
        <div class="card">
          <label class="field"><span>Discogs address</span><input id="apibase" value="${esc(s.apiBase)}" autocapitalize="off" autocorrect="off"></label>
          <p class="hint-text">Leave this alone unless you set up your own relay.</p>
          <button class="btn ghost danger-text" id="wipe">Delete everything on this phone</button>
        </div>
        <p class="hint-text center">Crate 1.0</p>
      </div>`;

    if (!s.username) bindTokenForm(root, draw);
    else {
      $('#import', root).onclick = () => runImport($('#import', root), $('#import-state', root));
      $('#disconnect', root).onclick = async () => { await saveSettings({ token: '', username: '' }); draw(); };
    }
    bindChips($('#d-media', root), (c) => { if (c) saveSettings({ mediaGrade: c }); });
    bindChips($('#d-sleeve', root), (c) => { if (c) saveSettings({ sleeveGrade: c }); });
    wireSpotify();
    $('#bg-chips', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-bg]');
      if (!b) return;
      root.querySelectorAll('#bg-chips .chip').forEach((c) => c.classList.toggle('on', c === b));
      saveSettings({ bgStyle: b.dataset.bg });
      toast('Saved. See it on the Library tab.');
    });
    $('#spin-chips', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-spin]');
      if (!b) return;
      root.querySelectorAll('#spin-chips .chip').forEach((c) => c.classList.toggle('on', c === b));
      saveSettings({ autoSpin: Number(b.dataset.spin) });
      toast(Number(b.dataset.spin) ? 'Saved.' : 'Spin turned off.');
    });
    $('#spin-now', root).onclick = () => { spinNow(); location.hash = '#/library'; };
    $('#t-coll', root).onchange = (e) => { saveSettings({ addToCollection: e.target.checked }); if (e.target.checked) kick(); };
    $('#t-price', root).onchange = (e) => { saveSettings({ fetchPrices: e.target.checked }); if (e.target.checked) kick(); };
    $('#reprice', root).onclick = async () => {
      if (!state.settings.username) { toast('Connect Discogs first.'); return; }
      await refreshAllPrices();
      toast('Checking prices in the background');
      draw();
    };
    $('#csv', root).onclick = async () => { try { await exportCsv(); } catch (e) { toast(e.message); } };
    $('#backup', root).onclick = async () => {
      try { const r = await exportBackup(); if (r !== 'cancelled') { toast('Backup saved'); draw(); } } catch (e) { toast(e.message); }
    };
    $('#restore', root).onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try { const c = await restoreBackup(f); toast(`Restored ${c.toLocaleString('en-GB')} records`); draw(); } catch (err) { toast(err.message); }
    };
    $('#apibase', root).onchange = (e) => {
      const v = e.target.value.trim().replace(/\/$/, '') || 'https://api.discogs.com';
      saveSettings({ apiBase: v });
      toast('Saved');
    };
    $('#wipe', root).onclick = async () => {
      const ok = await confirmSheet({ title: 'Delete everything?', text: `This removes all ${n.toLocaleString('en-GB')} records, photos and settings from this phone. Your Discogs account is not touched. This cannot be undone.`, yes: 'Delete everything', danger: true });
      if (!ok) return;
      await wipeAll();
      location.hash = '#/welcome';
      location.reload();
    };
  }
  function spotifyState() {
    const el = $('#sp-state', root);
    if (!el) return;
    const n = SP.lovedPending();
    const r = SP.recsPending();
    const parts = [];
    if (r) parts.push(`${r} record${r === 1 ? '' : 's'}`);
    if (n - r > 0) parts.push(`${n - r} loved track${n - r === 1 ? '' : 's'}`);
    el.textContent = SP.status.error || (n ? `Waiting to be added: ${parts.join(' and ')}. Keep the app open.` : 'Up to date.');
  }

  function wireSpotify() {
    const get = (id) => $(id, root);
    if (get('#sp-connect')) {
      get('#sp-id').onchange = (e) => saveSettings({ spotifyClientId: e.target.value.trim().toLowerCase() });
      get('#sp-connect').onclick = async () => {
        try {
          await saveSettings({ spotifyClientId: get('#sp-id').value.trim().toLowerCase() });
          await SP.startLogin();
        } catch (e) { toast(describeError(e)); }
      };
      get('#sp-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
          await SP.finishWithCode(get('#sp-code').value);
          toast('Spotify connected');
          draw();
        } catch (err) { toast(describeError(err), { ms: 6000 }); }
      };
      return;
    }
    get('#sp-all').onchange = (e) => saveSettings({ spotifyAll: e.target.checked });
    get('#sp-whole').onclick = async () => {
      const recs = [...state.records.values()].filter((r) => !r.spAllDone && r.status !== 'sold' && ((r.tracklist && r.tracklist.length) || (r.source === 'discogs' && r.releaseId)));
      if (!recs.length) { toast('Every record is already done'); return; }
      const tracks = recs.reduce((t, r) => t + ((r.tracklist && r.tracklist.length) || 10), 0);
      const mins = Math.max(1, Math.round((tracks * 0.4) / 60));
      const when = mins >= 90 ? `about ${Math.round(mins / 60)} hours` : `about ${mins} minute${mins === 1 ? '' : 's'}`;
      const ok = await confirmSheet({
        title: 'Add your whole collection?',
        text: `${recs.length.toLocaleString('en-GB')} records, about ${tracks.toLocaleString('en-GB')} tracks, into "${SP.ALL_NAME}". It takes ${when}. Keep Crate open and your screen on. It carries on where it stopped if you close it. Tracks Spotify does not have are skipped.`,
        yes: 'Start',
        no: 'Not now',
      });
      if (!ok) return;
      const n = await SP.enqueueWholeCollection();
      toast(`Adding ${n.toLocaleString('en-GB')} records`);
      spotifyState();
    };
    get('#sp-auto').onchange = (e) => { saveSettings({ spotifyAuto: e.target.checked }); if (e.target.checked) SP.kickLoved(); };
    get('#sp-now').onclick = async () => {
      const n = await SP.enqueueAllLoved();
      toast(n ? `Adding ${n} track${n === 1 ? '' : 's'} to Spotify` : 'Everything you love is already there');
      spotifyState();
    };
    get('#sp-off').onclick = async () => { await SP.disconnect(); draw(); };
    spotifyState();
  }

  draw();
  return subscribe((k) => { if (k === 'spotify') spotifyState(); });
}
