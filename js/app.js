// Starts the app: storage, screens, tab bar, sync bar, offline support.
import { init, state, subscribe } from './store.js';
import { status as sync, kick, pause, resume } from './sync.js';
import { net } from './discogs.js';
import { icon, esc, openSheet, toast } from './ui.js';
import * as library from './views/library.js';
import * as record from './views/record.js';
import * as scan from './views/scan.js';
import * as sell from './views/sell.js';
import * as value from './views/value.js';
import * as settings from './views/settings.js';

const views = {
  library,
  record,
  scan,
  sell,
  value,
  settings,
  welcome: { mount: settings.mountWelcome },
};
const tabOf = { record: 'library', welcome: 'settings' };

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

function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const { name, args } = parse();
  // A fresh container each time, so old event listeners go with it.
  view.innerHTML = '';
  const page = document.createElement('div');
  page.className = 'screen';
  view.appendChild(page);
  if (name !== 'library') window.scrollTo(0, 0);
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
  document.body.dataset.view = name;
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

// ---------------------------------------------------------------- boot

async function boot() {
  buildTabs();
  try {
    await init();
  } catch (e) {
    view.innerHTML = `<div class="page"><div class="empty"><h2>Storage is not available</h2><p>${esc(e.message || 'This browser would not open its storage.')}</p><p class="muted">Try leaving Private Browsing, or open the app from your Home Screen.</p></div></div>`;
    return;
  }
  subscribe((k) => { if (k === 'sync' || k === 'net') drawBar(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => kick());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  if (!location.hash && !state.settings.token && state.records.size === 0) location.hash = '#/welcome';
  route();
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
