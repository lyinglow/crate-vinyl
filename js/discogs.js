// Discogs API client.
// Discogs allows 60 requests a minute when signed in. Browsers cannot read the
// "remaining" header, so this file counts for itself: a bucket that holds up to
// 8 requests and refills at 0.9 a second (54 a minute). Waiting jobs are served
// by priority. 0 = something you are waiting for. 5 = quiet background work.
import { state, emit } from './store.js';

const RATE = 0.9;
const CAP = 8;

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const net = { queued: 0, waitingUntil: 0, lastError: '' };

const queue = [];
let tokens = CAP;
let last = Date.now();
let blockedUntil = 0;
let seq = 0;
let pumping = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function refill() {
  const now = Date.now();
  tokens = Math.min(CAP, tokens + ((now - last) / 1000) * RATE);
  last = now;
}

function note() {
  net.queued = queue.length;
  emit('net');
}

export function api(path, opts = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ path, opts, resolve, reject, p: opts.priority == null ? 2 : opts.priority, seq: seq++, tries: 0 });
    note();
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      const now = Date.now();
      if (now < blockedUntil) {
        net.waitingUntil = blockedUntil;
        emit('net');
        await sleep(Math.min(blockedUntil - now, 1000));
        continue;
      }
      net.waitingUntil = 0;
      refill();
      if (tokens < 1) {
        await sleep(((1 - tokens) / RATE) * 1000 + 20);
        continue;
      }
      queue.sort((a, b) => a.p - b.p || a.seq - b.seq);
      const job = queue.shift();
      tokens -= 1;
      note();
      try {
        const out = await run(job);
        job.resolve(out);
      } catch (e) {
        if (e && e.rateLimited) {
          blockedUntil = Date.now() + (e.retryAfter || 60) * 1000;
          tokens = 0;
          if (job.tries++ < 4) { queue.unshift(job); continue; }
          job.reject(new ApiError(429, 'Discogs says slow down. Try again in a minute.'));
        } else if (e instanceof ApiError && e.status === 0 && job.tries++ < 2 && navigator.onLine !== false) {
          await sleep(1500 * job.tries);
          queue.unshift(job);
        } else {
          job.reject(e);
        }
      }
    }
  } finally {
    pumping = false;
    note();
  }
}

async function run(job) {
  const s = state.settings;
  if (!s.token) throw new ApiError(401, 'Add your Discogs token in Settings first.');
  if (navigator.onLine === false) throw new ApiError(0, 'You are offline.');
  const url = new URL(s.apiBase.replace(/\/$/, '') + job.path);
  const o = job.opts;
  for (const [k, v] of Object.entries(o.query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }
  const method = o.method || 'GET';
  const init = { method, headers: {} };
  if (method === 'GET') {
    // A token in the address avoids an extra check by the browser, so it is faster.
    url.searchParams.set('token', s.token);
  } else {
    init.headers.Authorization = `Discogs token=${s.token}`;
    if (o.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  init.signal = ctrl.signal;
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError(0, e && e.name === 'AbortError' ? 'Discogs took too long to answer.' : 'Could not reach Discogs. Check your connection.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429) {
    const err = new Error('rate');
    err.rateLimited = true;
    err.retryAfter = Number(res.headers.get('Retry-After')) || 60;
    throw err;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not json */ }
  if (!res.ok) {
    const msg = (data && data.message) || res.statusText || 'Something went wrong';
    net.lastError = msg;
    throw new ApiError(res.status, msg, data);
  }
  return data;
}

const enc = encodeURIComponent;

export const D = {
  identity: () => api('/oauth/identity', { priority: 0 }),
  user: (u) => api(`/users/${enc(u)}`, { priority: 0 }),

  search: (query, page = 1, per = 25) =>
    api('/database/search', { query: { ...query, per_page: per, page }, priority: 0 }),
  release: (id, priority = 1) => api(`/releases/${id}`, { priority }),
  versions: (masterId, page = 1, filters = {}) =>
    api(`/masters/${masterId}/versions`, { query: { per_page: 50, page, ...filters }, priority: 0 }),

  collectionPage: (u, page, per = 100) =>
    api(`/users/${enc(u)}/collection/folders/0/releases`, { query: { page, per_page: per, sort: 'added', sort_order: 'asc' }, priority: 1 }),
  collectionAdd: (u, releaseId, folder = 1) =>
    api(`/users/${enc(u)}/collection/folders/${folder}/releases/${releaseId}`, { method: 'POST', priority: 1 }),
  collectionRemove: (u, folder, releaseId, instance) =>
    api(`/users/${enc(u)}/collection/folders/${folder}/releases/${releaseId}/instances/${instance}`, { method: 'DELETE', priority: 1 }),
  wantAdd: (u, releaseId) => api(`/users/${enc(u)}/wants/${releaseId}`, { method: 'PUT', priority: 1 }),
  wantRemove: (u, releaseId) => api(`/users/${enc(u)}/wants/${releaseId}`, { method: 'DELETE', priority: 1 }),
  collectionFields: (u) => api(`/users/${enc(u)}/collection/fields`, { priority: 1 }),
  setField: (u, folder, releaseId, instance, fieldId, value) =>
    api(`/users/${enc(u)}/collection/folders/${folder}/releases/${releaseId}/instances/${instance}/fields/${fieldId}`,
      { method: 'POST', query: { value }, body: { value }, priority: 3 }),
  collectionValue: (u) => api(`/users/${enc(u)}/collection/value`, { priority: 0 }),

  priceSuggestions: (id, priority = 5) => api(`/marketplace/price_suggestions/${id}`, { priority }),
  stats: (id, priority = 5) => api(`/marketplace/stats/${id}`, { priority }),
  listingCreate: (payload) => api('/marketplace/listings', { method: 'POST', body: payload, priority: 0 }),
  listingGet: (id) => api(`/marketplace/listings/${id}`, { priority: 0 }),
  listingDelete: (id) => api(`/marketplace/listings/${id}`, { method: 'DELETE', priority: 0 }),
};

export function friendly(e) {
  if (!(e instanceof ApiError)) return (e && e.message) || 'Something went wrong.';
  if (e.status === 401) return 'Discogs did not accept your token. Check it in Settings.';
  if (e.status === 0) return e.message;
  if (e.status === 429) return e.message;
  return e.message || 'Something went wrong.';
}
