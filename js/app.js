// Starts the app: storage, screens, tab bar, sync bar, offline support.
import { init, state, subscribe, saveSettings } from './store.js';
import { status as sync, kick, pause, resume } from './sync.js';
import { net } from './discogs.js';
import { icon, esc, openSheet, toast } from './ui.js';
import * as browse from './views/library.js';
import * as library from './views/carousel.js';
import * as record from './views/record.js';
import * as scan from './views/scan.js';
import * as sell from './views/sell.js';
import * as value from './views/value.js';
import * as settings from './views/settings.js';
import * as mixes from './views/mixes.js';
import * as loved from './views/loved.js';
import * as spotify from './spotify.js';

const views = {
  library,
  browse,
  record,
  scan,
  sell,
  value,
  settings,
  mixes,
  loved,
  // A one-tap link that saves your Spotify Client ID on this phone: #/spotifyid/<32 characters>
  spotifyid: {
    mount(root, args) {
      const id = String(args[0] || '').trim().toLowerCase();
      if (/^[0-9a-f]{32}$/.test(id)) {
        saveSettings({ spotifyClientId: id }).then(() => { toast('Spotify Client ID saved'); location.replace('#/settings'); });
      } else {
        toast('That is not a Spotify Client ID. It has 32 letters and numbers.');
        location.replace('#/settings');
      }
    },
  },
  welcome: { mount: settings.mountWelcome },
};
const tabOf = { record: 'library', browse: 'library', mixes: 'library', loved: 'library', welcome: 'settings' };

const view = document.getElementById('view');
const tabs = document.getElementById('tabs');
const bar = document.getElementById('syncbar');
let cleanup = null;

function buildTabs() {
  const items = [['library', 'Library', 'grid'], ['sell', 'Selling', 'tag'], ['scan', 'Scan', 'scan'], ['value', 'Value', 'value'], ['settings', 'Settings', 'gear']];
  tabs.innerHTML = items.map(([k, l, ic]) => `<a href="#/${k}" data-tab="${k}" class="${k === 'scan' ? 'center' : ''}"><span class="ti">${icon(ic, k === 'scan' ? 26 : 24)}</span><span class="tl">${l}</span></a>`).join('');
}

function parse() {
  const h = location.hash.replace(/^#\/?/, '') || 'library';
  const [name, ...rest] = h.split('/');
  return { name: views[name] ? name : 'library', args: rest.map(decodeURIComponent) };
}

const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

const noMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let prevName = null;

function render(name, args) {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  // A fresh container each time, so old event listeners go with it.
  view.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'screen';
  view.appendChild(page);
  if (name !== 'library') window.scrollTo(0, 0);
  document.body.dataset.view = name;
  try {
    cleanup = views[name].mount(page, args) || null;
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="page"><div class="empty small"><p>Something went wrong showing this screen.</p><p class="muted">${esc(e.message)}</p><a class="btn small" href="#/library">Back to the library</a></div></div>`;
  }
  if (isIos && !standalone && (name === 'welcome' || name === 'settings')) {
    const p = page.querySelector('.page');
    if (p) p.insertAdjacentHTML('afterbegin', '<div class="banner">For the best result, tap the Share button, then <b>Add to Home Screen</b>. It opens full screen and your data stays safe.</div>');
  }
  const active = tabOf[name] || name;
  tabs.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.tab === active));
}

function route() {
  const { name, args } = parse();
  // The sleeve in the middle grows into the record page, and shrinks back again.
  const morph = document.startViewTransition && !noMotion() && prevName
    && ((prevName === 'library' && name === 'record') || (prevName === 'record' && name === 'library'));
  prevName = name;
  if (morph) document.startViewTransition(() => render(name, args));
  else render(name, args);
}

// ---------------------------------------------------------------- sync bar

let wake = null;
async function holdScreen(on) {
  try {
    if (on && !wake && 'wakeLock' in navigator) {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } else if (!on && wake) {
      await wake.release();
      wake = null;
    }
  } catch { /* not allowed, that is fine */ }
}

function drawBar() {
  const waiting = net.waitingUntil > Date.now();
  const show = state.settings.token && (sync.error || waiting || (sync.running && sync.pending > 0) || sync.paused);
  holdScreen(!!sync.running);
  if (!show) { bar.hidden = true; document.body.classList.remove('has-bar'); return; }
  let text;
  if (sync.paused) text = 'Sync paused';
  else if (sync.error) text = sync.error;
  else if (waiting) text = 'Waiting a moment for Discogs';
  else text = `${sync.label || 'Syncing with Discogs'}. ${sync.pending.toLocaleString('en-GB')} to go`;
  bar.hidden = false;
  document.body.classList.add('has-bar');
  bar.innerHTML = `<i class="pulse ${sync.running && !sync.paused && !sync.error ? 'on' : ''}"></i><span>${esc(text)}</span>`;
}

bar.addEventListener('click', () => {
  const s = openSheet({
    title: 'Syncing with Discogs',
    body: `<p class="muted">${sync.error ? esc(sync.error) : `${sync.pending.toLocaleString('en-GB')} small jobs left: adding to your Discogs collection, saving grades and checking prices.`}</p>
      <p class="muted">Discogs allows about 60 requests a minute, so big jobs take a while. Keep the app open and the screen on. It remembers where it got to if you close it.</p>
      <div class="stack"><button class="btn primary" id="sy">${sync.paused ? 'Carry on' : 'Pause'}</button><button class="btn ghost" id="sc">Close</button></div>`,
  });
  s.el.querySelector('#sy').onclick = () => { if (sync.paused) resume(); else pause(); s.close(); };
  s.el.querySelector('#sc').onclick = () => s.close();
});

// Spotify sent you back to a window that did not start the sign in. Show the code to take back to Crate.
function showCode(code) {
  tabs.hidden = true;
  view.innerHTML = `<div class="page welcome"><div class="disc big"></div><h1>Almost there</h1>
    <p class="lead">Copy this code. Close this window. Then paste it into Crate under Settings, Spotify.</p>
    <div class="card"><input id="code" readonly value="${esc(code)}" aria-label="Your code"></div>
    <div class="stack"><button class="btn primary" id="copy">Copy the code</button></div></div>`;
  const input = view.querySelector('#code');
  view.querySelector('#copy').onclick = async () => {
    input.select();
    try { await navigator.clipboard.writeText(code); view.querySelector('#copy').textContent = 'Copied'; } catch { document.execCommand && document.execCommand('copy'); }
  };
}

// ---------------------------------------------------------------- boot

async function boot() {
  if (!document.startViewTransition) document.documentElement.classList.add('no-vt');
  buildTabs();
  try {
    await init();
  } catch (e) {
    view.innerHTML = `<div class="page"><div class="empty"><h2>Storage is not available</h2><p>${esc(e.message || 'This browser would not open its storage.')}</p><p class="muted">Try leaving Private Browsing, or open the app from your Home Screen.</p></div></div>`;
    return;
  }
  subscribe((k) => { if (k === 'sync' || k === 'net') drawBar(); });
  subscribe((k) => {
    if (k !== 'spotify' || spotify.status.busy || !spotify.missed.length) return;
    const names = spotify.missed.splice(0);
    toast(names.length === 1 ? `Not on Spotify: ${names[0]}` : `${names.length} tracks are not on Spotify`, { ms: 6000 });
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { kick(); spotify.kickLoved(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { kick(); spotify.kickLoved(); } });
  const back = await spotify.handleReturn();
  if (back.kind === 'copy') { showCode(back.code); return; }
  if (back.kind === 'done' || back.kind === 'error') location.hash = '#/settings';
  if (!location.hash && !state.settings.token && state.records.size === 0) location.hash = '#/welcome';
  route();
  if (back.kind === 'done') toast('Spotify connected');
  if (back.kind === 'error') toast(back.message, { ms: 7000 });
  spotify.kickLoved();
  drawBar();
  kick();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('sw', e));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had) toast('A new version is ready.', { action: 'Reload', onAction: () => location.reload(), ms: 15000 });
    });
  }
}

boot();
