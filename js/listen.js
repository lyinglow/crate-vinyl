// The Listen panel: videos Discogs holds for a release, played in place. Dig and the person page both use it.
import { state, saveSettings } from './store.js';
import * as M from './model.js';
import { D } from './discogs.js';
import { esc, icon, openSheet, describeError } from './ui.js';

export const heardMap = () => (state.settings.digHeard && typeof state.settings.digHeard === 'object' ? state.settings.digHeard : {});

// Opening Listen counts as heard.
export const markHeard = (key) => saveSettings({ digHeard: { ...heardMap(), [key]: Date.now() } });

export async function listenTo({ artist, title, releaseId }) {
  const s = openSheet({ title: 'Listen', body: `<p class="muted"><b>${esc(artist)}</b><br>${esc(title)}</p><div id="d-vids"><p class="muted">Looking for videos...</p></div>` });
  try {
    const rel = await D.release(releaseId, 0);
    const vids = M.uniqueVideos((rel.videos || []).map((v) => ({ id: M.youtubeId(v.uri), title: v.title || '', duration: v.duration || 0 })).filter((v) => v.id)).slice(0, 12);
    const box = s.el.querySelector('#d-vids');
    if (!vids.length) { box.innerHTML = '<p class="muted">Discogs has no videos for this release.</p>'; return s; }
    const player = (id) => `<div class="player"><iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?playsinline=1&autoplay=1" title="Video player" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>`;
    box.innerHTML = `<div id="d-player">${player(vids[0].id)}</div><div class="rows">${vids.map((v, i) => `<button class="play-row${i ? '' : ' on'}" data-play="${esc(v.id)}"><span class="pi">${icon('play', 18)}</span><span class="pt">${esc(v.title)}</span><span class="pd">${esc(M.clock(v.duration))}</span></button>`).join('')}</div>`;
    box.onclick = (e) => {
      const b = e.target.closest('[data-play]');
      if (!b) return;
      box.querySelectorAll('.play-row').forEach((r) => r.classList.toggle('on', r === b));
      box.querySelector('#d-player').innerHTML = player(b.dataset.play);
    };
  } catch (e) {
    s.el.querySelector('#d-vids').innerHTML = `<p class="muted">${esc(describeError(e))}</p>`;
  }
  return s;
}
