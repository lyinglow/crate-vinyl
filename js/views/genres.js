// The genre and style picker. Genre is the broad kind (Rock, Jazz, Electronic).
// Style is the finer kind Discogs gives (Hard Bop, Synth-pop). Choosing one narrows the cover flow at once.
import { state } from '../store.js';
import * as M from '../model.js';
import { filterState as F } from './library.js';
import { esc, icon, openSheet } from '../ui.js';

// What to show on the button.
export function genreLabel() {
  const g = F.genre === M.NONE ? 'No genre' : F.genre;
  return [F.loved ? 'Loved' : '', g, F.style].filter(Boolean).join(' · ') || 'Genre';
}
export const genreOn = () => !!(F.genre || F.style || F.loved);

// Records that pass every filter except genre and style, so the counts match what you will see.
const everyone = () => M.filterRecords([...state.records.values()], { ...F, genre: '', style: '', loved: false });
const base = () => (F.loved ? everyone().filter((r) => (r.loved || []).length) : everyone());

export function openGenreSheet(onChange) {
  const s = openSheet({ title: 'Filter', body: '<div id="gs"></div>' });
  const box = s.el.querySelector('#gs');

  function draw() {
    const recs = base();
    const { genres, none } = M.genreCounts(recs);
    const styles = F.genre && F.genre !== M.NONE ? M.styleCounts(recs, F.genre) : M.styleCounts(recs, '');
    const shown = M.filterRecords(recs, { genre: F.genre, style: F.style }).length;
    const chip = (attr, on, label, n) => `<button type="button" class="chip${on ? ' on' : ''}" ${attr}>${esc(label)}<small class="n">${n}</small></button>`;
    const lovedN = everyone().filter((r) => (r.loved || []).length).length;
    box.innerHTML = `
      <div class="chips" id="lchips"><button type="button" class="chip loved-chip${F.loved ? ' on' : ''}" data-loved>${icon('heart', 15)} Records with a loved track<small class="n">${lovedN}</small></button></div>
      <h3 class="sec">Genre</h3>
      <div class="chips" id="gchips">
        ${chip('data-g=""', !F.genre, 'All', recs.length)}
        ${genres.map(([g, n]) => chip(`data-g="${esc(g)}"`, F.genre === g, g, n)).join('')}
        ${none ? chip(`data-g="${M.NONE}"`, F.genre === M.NONE, 'No genre', none) : ''}
      </div>
      ${styles.length && F.genre !== M.NONE ? `<h3 class="sec">${F.genre ? `Styles in ${esc(F.genre)}` : 'Styles'}</h3>
        <div class="chips" id="schips">
          ${chip('data-s=""', !F.style, 'All styles', M.filterRecords(recs, { genre: F.genre }).length)}
          ${styles.map(([x, n]) => chip(`data-s="${esc(x)}"`, F.style === x, x, n)).join('')}
        </div>` : ''}
      <div class="stack"><button class="btn primary" id="done">Show ${shown.toLocaleString('en-GB')} record${shown === 1 ? '' : 's'}</button></div>`;
  }
  draw();

  box.addEventListener('click', (e) => {
    const g = e.target.closest('[data-g]');
    const st = e.target.closest('[data-s]');
    const lv = e.target.closest('[data-loved]');
    if (lv) {
      F.loved = !F.loved;
    } else if (g) {
      F.genre = g.dataset.g;
      F.style = '';
    } else if (st) {
      F.style = st.dataset.s;
    } else if (e.target.closest('#done')) {
      s.close();
      return;
    } else {
      return;
    }
    F.count = 120;
    draw();
    onChange();
  });
}
