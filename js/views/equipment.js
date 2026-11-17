// Equipment: your turntable, cartridge, amp, speakers and the rest, with the hours on each stylus.
import { state, saveEquipment, putPhoto, delPhoto, subscribe } from '../store.js';
import * as M from '../model.js';
import * as G from '../gear.js';
import { esc, icon, openSheet, confirmSheet, toast, pickPhoto, hydratePhotos, $ } from '../ui.js';

const money = (n) => M.money(n, state.settings.currency, Math.abs(n) >= 1000 ? 0 : 2);

function wearBar(g) {
  const w = G.wear(g);
  if (!w) return '';
  return `<div class="wear ${w.tone}"><div class="meter"><i style="width:${Math.min(100, Math.round(w.pct * 100))}%"></i></div>
    <p>${esc(G.hoursText(w.used))} of ${esc(G.hoursText(w.life))} on this stylus. <b>${esc(w.word)}</b>${w.pct < 1 ? `, ${esc(G.hoursText(w.left))} left` : ''}.</p></div>`;
}

// The add and edit sheet. Pass a gear item to edit it, or nothing to add one.
export function openGearSheet(existing) {
  const item = existing || G.newItem();
  const fresh = !existing;
  let photoBlob = null;
  const s = openSheet({ title: fresh ? 'Add equipment' : 'Equipment', className: 'gear', body: `
    <form id="g-form" class="form">
      <div class="field"><span>What is it</span><div class="chips" id="g-kinds">${G.KINDS.map((k) => `<button type="button" class="chip${k === item.kind ? ' on' : ''}" data-k="${esc(k)}">${esc(k)}</button>`).join('')}</div></div>
      <label class="field"><span>Name</span><input name="name" value="${esc(item.name)}" placeholder="For example Living room deck" autocomplete="off"></label>
      <div class="two">
        <label class="field"><span>Brand</span><input name="brand" value="${esc(item.brand)}" placeholder="Technics" autocomplete="off"></label>
        <label class="field"><span>Model</span><input name="model" value="${esc(item.model)}" placeholder="SL-1200 MK7" autocomplete="off"></label>
      </div>
      <div class="two">
        <label class="field"><span>Bought</span><input name="bought" type="date" value="${esc(item.bought)}"></label>
        <label class="field"><span>Price paid</span><input name="price" inputmode="decimal" value="${item.price == null ? '' : esc(String(item.price))}" placeholder="0.00" autocomplete="off"></label>
      </div>
      <label class="field"><span>Serial number</span><input name="serial" value="${esc(item.serial)}" autocomplete="off"></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="2" placeholder="Settings, tracking weight, repairs, anything useful">${esc(item.notes)}</textarea></label>
      <div class="field"><span>Photo</span><button type="button" class="photo-btn" id="g-photo"><span>${icon('camera', 22)}</span>Add a photo</button></div>
      <div id="g-stylus"></div>
      <button class="btn primary big" type="submit">${fresh ? 'Add it' : 'Save'}</button>
      ${fresh ? '' : '<button type="button" class="btn ghost danger-text" id="g-delete">Delete this</button>'}
    </form>` });
  const root = s.el;

  async function showPhoto() {
    const btn = $('#g-photo', root);
    let url = '';
    if (photoBlob) url = URL.createObjectURL(photoBlob);
    else if (item.photo) { const { photoUrl } = await import('../store.js'); url = await photoUrl(item.photo); }
    if (url) { btn.classList.add('has'); btn.innerHTML = `<img src="${url}" alt="">`; }
  }
  showPhoto();

  function drawStylus() {
    const box = $('#g-stylus', root);
    if (item.kind !== G.CART) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="stylus">
      <h3 class="sec">Stylus hours</h3>
      ${wearBar(item)}
      <p class="muted">Add the time you play. A side is about 20 minutes, an album about 45.</p>
      <div class="row-btns"><button type="button" class="btn small" data-h="0.33">A side</button><button type="button" class="btn small" data-h="0.75">An album</button><button type="button" class="btn small" data-h="1">An hour</button><button type="button" class="btn small" data-h="-0.33">Undo a side</button></div>
      <label class="field"><span>Hours it should last</span><input name="life" inputmode="numeric" value="${esc(String(item.life || G.DEFAULT_LIFE))}" autocomplete="off"></label>
      <div class="row-btns"><button type="button" class="btn small" id="g-new">I fitted a new stylus</button></div>
      ${(item.log || []).length ? `<ul class="gearlog">${item.log.slice(0, 5).map((l) => `<li>${esc(M.dateStr(l.at))}: ${l.kind === 'new' ? 'New stylus fitted' : `${l.h < 0 ? 'Took off' : 'Played'} ${esc(G.hoursText(Math.abs(l.h)))}`}</li>`).join('')}</ul>` : ''}
    </div>`;
  }
  drawStylus();

  root.addEventListener('click', async (e) => {
    const k = e.target.closest('[data-k]');
    if (k) { item.kind = k.dataset.k; root.querySelectorAll('#g-kinds .chip').forEach((c) => c.classList.toggle('on', c === k)); drawStylus(); return; }
    const h = e.target.closest('[data-h]');
    if (h) {
      const v = Number(h.dataset.h);
      if (v < 0 && item.hours <= 0) return;
      G.addHours(item, v < 0 ? -Math.min(item.hours, -v) : v);
      if (!fresh) { await persist(); }
      drawStylus();
      return;
    }
    if (e.target.closest('#g-new')) {
      const ok = await confirmSheet({ title: 'New stylus?', text: 'The hours go back to zero. The old count stays in the history.', yes: 'Yes, fitted' });
      if (!ok) return;
      G.newStylus(item);
      if (!fresh) await persist();
      drawStylus();
      return;
    }
    if (e.target.closest('#g-photo')) {
      const b = await pickPhoto();
      if (b) { photoBlob = b; showPhoto(); }
      return;
    }
    if (e.target.closest('#g-delete')) {
      const ok = await confirmSheet({ title: 'Delete this?', text: G.title(item), yes: 'Delete', danger: true });
      if (!ok) return;
      state.equipment = state.equipment.filter((x) => x.id !== item.id);
      await saveEquipment();
      if (item.photo) await delPhoto(item.photo);
      s.close();
      toast('Deleted');
    }
  });

  function read() {
    const fd = new FormData($('#g-form', root));
    const g = (n) => String(fd.get(n) || '').trim();
    Object.assign(item, { name: g('name'), brand: g('brand'), model: g('model'), bought: g('bought'), serial: g('serial'), notes: String(fd.get('notes') || '').trim() });
    const p = g('price').replace(/[^0-9.]/g, '');
    item.price = p === '' ? null : Number(p);
    if (item.kind === G.CART) { const l = Number(g('life')); item.life = l > 0 ? l : G.DEFAULT_LIFE; }
  }

  async function persist() {
    read();
    item.updated = Date.now();
    if (photoBlob) { item.photo = item.photo || `gear-${item.id}`; await putPhoto(item.photo, photoBlob); photoBlob = null; }
    const at = state.equipment.findIndex((x) => x.id === item.id);
    if (at >= 0) state.equipment[at] = item; else state.equipment.push(item);
    await saveEquipment();
  }

  $('#g-form', root).onsubmit = async (e) => {
    e.preventDefault();
    read();
    if (!item.name && !item.brand && !item.model) { toast('Give it a name, or a brand and model.'); return; }
    await persist();
    s.close();
    toast(fresh ? 'Added' : 'Saved');
  };
}

export function mount(root) {
  root.innerHTML = `
    <div class="page">
      <a class="back" href="#/library">${icon('back', 20)} Library</a>
      <div class="largetitle"><h1>Equipment</h1><p class="sub" id="g-sub"></p></div>
      <div class="row-btns"><button class="btn primary" id="g-add">Add equipment</button></div>
      <div id="g-list"></div>
    </div>`;

  function draw() {
    const n = state.equipment.length;
    const t = G.total();
    $('#g-sub', root).textContent = n ? `${n} item${n === 1 ? '' : 's'}${t ? ` · ${money(t)} paid` : ''}` : '';
    const el = $('#g-list', root);
    if (!n) {
      el.innerHTML = '<div class="empty small"><p>Nothing here yet.</p><p class="muted">Add your turntable, cartridge, amp and speakers. A cartridge keeps count of the hours on its stylus, so you know when it needs replacing.</p></div>';
      return;
    }
    el.innerHTML = G.byKind().map(([kind, list]) => `
      <h3 class="sec">${esc(kind)}</h3>
      <div class="rows">${list.map((g) => {
        const w = G.wear(g);
        return `<button class="grow" data-g="${esc(g.id)}">
          <div class="gthumb">${g.photo ? `<img data-photo="${esc(g.photo)}" alt="">` : icon('deck', 26)}</div>
          <div class="gtext"><b>${esc(G.title(g))}</b>${g.name && G.title(g) !== g.name ? `<span>${esc(g.name)}</span>` : ''}<span>${esc([g.bought ? M.dateStr(Date.parse(g.bought)) : '', g.price != null ? money(g.price) : ''].filter(Boolean).join(' · '))}</span>
          ${w ? `<span class="gwear ${w.tone}">${esc(G.hoursText(w.used))} of ${esc(G.hoursText(w.life))} · ${esc(w.word)}</span>` : ''}</div>
          ${icon('chevron', 18)}
        </button>`;
      }).join('')}</div>`).join('');
    hydratePhotos(el);
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('#g-add')) { openGearSheet(null); return; }
    const row = e.target.closest('[data-g]');
    if (row) openGearSheet(state.equipment.find((g) => g.id === row.dataset.g));
  });

  draw();
  return subscribe((k) => { if (k === 'equipment') draw(); });
}
