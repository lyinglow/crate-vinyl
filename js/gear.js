// Your equipment: turntables, cartridges, amps, speakers and the rest.
// A cartridge also keeps count of the hours on its stylus, so you know when it is worn.
import { state, newId } from './store.js';

export const KINDS = ['Turntable', 'Cartridge and stylus', 'Phono preamp', 'Amplifier', 'Speakers', 'Headphones', 'Mixer', 'Other'];
export const CART = 'Cartridge and stylus';
export const DEFAULT_LIFE = 500; // a typical stylus is good for about 500 to 1,000 hours

export function newItem(kind = 'Turntable') {
  const now = Date.now();
  return { id: newId(), kind, name: '', brand: '', model: '', bought: '', price: null, serial: '', notes: '', photo: '', life: DEFAULT_LIFE, hours: 0, fitted: 0, log: [], added: now, updated: now };
}

export const title = (g) => [g.brand, g.model].filter(Boolean).join(' ') || g.name || g.kind;

// How worn the stylus is, as a fraction and a plain word.
export function wear(g) {
  if (g.kind !== CART) return null;
  const life = Number(g.life) > 0 ? Number(g.life) : DEFAULT_LIFE;
  const used = Number(g.hours) || 0;
  const pct = used / life;
  return { used, life, pct, left: Math.max(0, life - used), word: pct >= 1 ? 'Time to replace' : pct >= 0.8 ? 'Replace soon' : 'Good', tone: pct >= 1 ? 'bad' : pct >= 0.8 ? 'warn' : 'ok' };
}

export const hoursText = (h) => `${(Math.round((Number(h) || 0) * 10) / 10).toLocaleString('en-GB')} h`;

export function addHours(g, hours, note = '') {
  g.hours = Math.round(((Number(g.hours) || 0) + hours) * 100) / 100;
  g.log = [{ at: Date.now(), kind: 'play', h: hours, note }, ...(g.log || [])].slice(0, 60);
  g.updated = Date.now();
}

export function newStylus(g) {
  g.log = [{ at: Date.now(), kind: 'new', h: Number(g.hours) || 0, note: 'New stylus fitted' }, ...(g.log || [])].slice(0, 60);
  g.hours = 0;
  g.fitted = Date.now();
  g.updated = Date.now();
}

export const total = () => state.equipment.reduce((t, g) => t + (Number(g.price) || 0), 0);
export const byKind = () => KINDS.map((k) => [k, state.equipment.filter((g) => g.kind === k).sort((a, b) => title(a).localeCompare(title(b)))]).filter(([, l]) => l.length);
