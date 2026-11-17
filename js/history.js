// A line of what your collection has been worth, one point a day. It is kept so you can see the trend.
import { state, saveHistory } from './store.js';
import * as M from './model.js';

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// What the collection is worth right now, counting only what has a price.
export function snapshotNow() {
  let worth = 0; let priced = 0; let n = 0; let paid = 0; let paidWorth = 0; let paidN = 0;
  for (const r of state.records.values()) {
    if (r.wanted || r.status === 'sold') continue;
    n++;
    const e = M.estimate(r);
    if (e != null) { worth += e; priced++; }
    const p = r.paid != null && r.paid !== '' ? Number(r.paid) : NaN;
    if (isFinite(p)) { paid += p; paidN++; if (e != null) paidWorth += e; }
  }
  return { d: day(), t: Date.now(), worth: Math.round(worth * 100) / 100, priced, n, paid: Math.round(paid * 100) / 100, paidN, paidWorth: Math.round(paidWorth * 100) / 100 };
}

// Save today's point. A day keeps the fuller picture: more records priced wins.
let lastTry = 0;
export async function takeSnapshot(force = false) {
  if (!force && Date.now() - lastTry < 60000) return false; // not on every redraw while prices load
  lastTry = Date.now();
  const s = snapshotNow();
  if (!s.priced) return false;
  const i = state.history.findIndex((x) => x.d === s.d);
  if (i >= 0) {
    const o = state.history[i];
    if ((o.priced || 0) > s.priced) return false;
    if (o.priced === s.priced && o.worth === s.worth && o.paid === s.paid && o.n === s.n) return false;
    state.history[i] = s;
  } else state.history.push(s);
  state.history.sort((a, b) => (a.d < b.d ? -1 : 1));
  if (state.history.length > 1500) state.history.splice(0, state.history.length - 1500);
  await saveHistory();
  return true;
}

// Points good enough to draw: at least nine in ten records had a price that day.
export function series(days = 90) {
  const from = day(Date.now() - days * 864e5);
  return state.history.filter((x) => x.d >= from && x.n > 0 && x.priced / x.n >= 0.9);
}
