// Where a record you add is going: your collection, or your wanted list. Kept for this sitting only,
// so the next time you open Crate it starts on your collection again.
const KEY = 'crate-add-target';
export const target = { wanted: false };
try { target.wanted = sessionStorage.getItem(KEY) === 'wanted'; } catch { /* fine */ }

export function setWanted(v) {
  target.wanted = !!v;
  try { sessionStorage.setItem(KEY, v ? 'wanted' : 'mine'); } catch { /* fine */ }
}

// The two choices, as chips. Tap one to switch.
export function targetChips(id = 'add-target') {
  return `<div class="target" id="${id}" role="group" aria-label="Where this record goes">
    <span class="lbl">Adding to</span>
    <button type="button" class="chip${target.wanted ? '' : ' on'}" data-w="0">My collection</button>
    <button type="button" class="chip${target.wanted ? ' on' : ''}" data-w="1">Wanted list</button>
  </div>`;
}

export function bindTarget(host, onChange) {
  host.addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    setWanted(b.dataset.w === '1');
    host.querySelectorAll('[data-w]').forEach((c) => c.classList.toggle('on', c === b));
    if (onChange) onChange(target.wanted);
  });
}
