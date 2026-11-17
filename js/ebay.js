// Asks your own Crate server for eBay prices. See docs/EBAY.md for the one time setup.
import { accessToken } from './cloud.js';

export async function lookup(item) {
  const q = [item.brand, item.model].filter(Boolean).join(' ') || item.name || '';
  if (q.trim().length < 3) throw new Error('Add a brand and model first.');
  const token = await accessToken();
  if (!token) throw new Error('Sign in under Settings, Sync across devices, to use eBay prices.');
  let r;
  try {
    r = await fetch(`/api/ebay?${new URLSearchParams({ q, kind: item.kind || '' })}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch { throw new Error('Could not reach your Crate server. Check your connection.'); }
  let j = {};
  try { j = await r.json(); } catch { /* not json */ }
  if (r.status === 404) throw new Error('eBay prices are not switched on for this site yet. The steps are in docs/EBAY.md.');
  if (!r.ok) throw new Error(j.message || `The price check failed (${r.status}).`);
  return j;
}
