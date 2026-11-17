// Asks eBay what a piece of gear is selling for. It runs on Vercel, because eBay's secret key must never
// be inside the app. Only someone signed in to your Crate sync (checked with your Supabase project) may use it.
//
// Environment variables, set in Vercel:  EBAY_CLIENT_ID  EBAY_CLIENT_SECRET  SUPABASE_URL  SUPABASE_ANON_KEY
// For tests only:                        EBAY_API_BASE  EBAY_AUTH_BASE

const API = () => (process.env.EBAY_API_BASE || 'https://api.ebay.com').replace(/\/+$/, '');
const AUTH = () => (process.env.EBAY_AUTH_BASE || 'https://api.ebay.com').replace(/\/+$/, '');

let appToken = null; // { value, exp }
const people = new Map(); // bearer token -> { id, exp }
const hits = new Map(); // user id -> times of recent lookups
const PER_HOUR = 150;

const send = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

class Problem extends Error {
  constructor(status, error, message) { super(message); this.status = status; this.error = error; }
}

// Who is asking? A Crate sync session, checked with Supabase. Nobody else gets in.
async function who(req) {
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer \S{20,}$/.test(auth)) return null;
  const known = people.get(auth);
  if (known && known.exp > Date.now()) return known.id;
  const base = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!base || !anon) throw new Problem(501, 'not_configured', 'Crate cannot check who you are yet. Add SUPABASE_URL and SUPABASE_ANON_KEY in Vercel.');
  let r;
  try { r = await fetch(`${base.replace(/\/+$/, '')}/auth/v1/user`, { headers: { apikey: anon, Authorization: auth } }); } catch { throw new Problem(502, 'supabase', 'Could not reach Supabase to check your sign in.'); }
  if (!r.ok) return null;
  const u = await r.json();
  if (!u || !u.id) return null;
  people.set(auth, { id: u.id, exp: Date.now() + 60000 });
  return u.id;
}

async function token() {
  if (appToken && appToken.exp > Date.now() + 60000) return appToken.value;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  let r;
  try {
    r = await fetch(`${AUTH()}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` },
      body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
    });
  } catch { throw new Problem(502, 'ebay', 'Could not reach eBay.'); }
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok || !j.access_token) throw new Problem(502, 'ebay_key', `eBay would not give Crate a key. ${j.error_description || j.error || `It answered ${r.status}.`} Check the keys in Vercel, and that your eBay production keyset is active.`);
  appToken = { value: j.access_token, exp: Date.now() + (Number(j.expires_in) || 7200) * 1000 };
  return appToken.value;
}

// Listings that are not the thing itself: spares, repairs, boxes and the like.
const NOT_THE_THING = /\b(spares?|repairs?|for parts|parts only|faulty|broken|not working|untested|box only|empty box|manual|instructions|dust ?cover|lid only|belt|slipmat|replacement|compatible|fits|fitting|wanted)\b/i;

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);

async function lookup(q, kind) {
  const t = await token();
  const params = new URLSearchParams({ q, limit: '100', filter: 'priceCurrency:GBP,price:[10..]' });
  let r;
  try { r = await fetch(`${API()}/buy/browse/v1/item_summary/search?${params}`, { headers: { Authorization: `Bearer ${t}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB' } }); } catch { throw new Problem(502, 'ebay', 'Could not reach eBay.'); }
  let j = {};
  try { j = await r.json(); } catch { /* empty */ }
  if (r.status === 401 || r.status === 403) { appToken = null; throw new Problem(502, 'ebay_key', 'eBay refused the search. The Browse API may not be switched on for your keys.'); }
  if (!r.ok) throw new Problem(502, 'ebay', `eBay could not do that search (${r.status}). ${(j.errors && j.errors[0] && j.errors[0].message) || ''}`.trim());

  const words = q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  const need = Math.max(1, Math.ceil(words.length * 0.75));
  const accessories = kind !== 'Cartridge and stylus';
  const rows = [];
  for (const it of j.itemSummaries || []) {
    const price = Number(it.price && it.price.value);
    if (!(price > 0) || (it.price.currency && it.price.currency !== 'GBP')) continue;
    const title = String(it.title || '');
    const lower = title.toLowerCase();
    if (words.filter((w) => lower.includes(w)).length < need) continue; // not really this item
    if (accessories && NOT_THE_THING.test(title)) continue;
    rows.push({ title, price, url: it.itemWebUrl || '', image: (it.image && it.image.imageUrl) || '', condition: it.condition || '' });
  }
  const prices = rows.map((x) => x.price).sort((a, b) => a - b);
  return {
    query: q,
    market: 'eBay UK',
    total: Number(j.total) || rows.length,
    used: rows.length,
    low: round(percentile(prices, 0.25)),
    mid: round(percentile(prices, 0.5)),
    high: round(percentile(prices, 0.75)),
    min: prices.length ? round(prices[0]) : null,
    max: prices.length ? round(prices[prices.length - 1]) : null,
    currency: 'GBP',
    note: 'Asking prices of live listings, not what things sold for.',
    items: rows.sort((a, b) => a.price - b.price).slice(0, 5),
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return send(res, 405, { error: 'method', message: 'Use GET.' });
    if (!process.env.EBAY_CLIENT_ID || !process.env.EBAY_CLIENT_SECRET) return send(res, 501, { error: 'not_configured', message: 'eBay is not set up yet. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel.' });
    const uid = await who(req);
    if (!uid) return send(res, 401, { error: 'sign_in', message: 'Sign in to Crate sync first.' });
    const now = Date.now();
    const recent = (hits.get(uid) || []).filter((x) => now - x < 3600000);
    if (recent.length >= PER_HOUR) return send(res, 429, { error: 'slow_down', message: 'That is a lot of lookups in an hour. Try again later.' });
    hits.set(uid, [...recent, now]);
    const url = new URL(req.url, 'http://x');
    const q = String(url.searchParams.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (q.length < 3) return send(res, 400, { error: 'query', message: 'Give a brand and model to search for.' });
    return send(res, 200, await lookup(q, String(url.searchParams.get('kind') || '')));
  } catch (e) {
    if (e instanceof Problem) return send(res, e.status, { error: e.error, message: e.message });
    return send(res, 500, { error: 'crash', message: 'Something went wrong on the server.' });
  }
};
