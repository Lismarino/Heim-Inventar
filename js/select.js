// Aktionen an Einträgen: Kontextmenü, Löschen (in den Papierkorb) mit Rückgängig, Unterwegs/verliehen,
// Mehrfachauswahl, Bestand ± in der Zeile, Checkliste je Ort, „Habe ich das schon?“.
import * as db from './db.js';
import * as img from './img.js';
import * as ai from './gemini.js';
import * as queue from './queue.js';
import * as sheet from './sheet.js';
import * as sound from './sound.js';
import { hideCombo } from './combo.js';
import { haptic } from './gestures.js';
import { cleanOut, findSimilar, outText } from './match.js';
import { $, $$, esc, icon, isThumb, placeholderHTML, plural } from './ui.js';
import { closeSwipes, renderCurrent } from './nav.js';
import { aiBusy, hasKey, hasPlace, placeById, placeOf, refreshItems, reloadAll, state, whereOf, whereShort, whereText } from './state.js';
import { hideToast, toast, toastAction } from './toast.js';
import { openItem } from './view-item.js';
import { rowHTML } from './view-list.js';
import { placeHead } from './view-room.js';
import { keyHint, updateStorageInfo } from './view-settings.js';
import { resolveWhere, whereSheet } from './where.js';

export function itemHead(it) {
  const pic = isThumb(it.thumb) ? `<img class="sh-pic" src="${esc(it.thumb)}" alt="">` : placeholderHTML(it, 'sh-pic');
  const place = hasPlace(it) ? [whereOf(it, ' · '), it.locationDetail].filter(Boolean).join(' · ') : 'Ohne Ort';
  const name = it.name || (aiBusy(it) ? 'wird erkannt …' : 'Unbenannt');
  return `${pic}<span class="sh-txt"><b>${esc(name)}</b><small>${esc(place)}</small></span>`;
}

export function itemMenu(id) {
  const it = state.items.find(x => x.id === id);
  if (!it || it.archived) return;
  sheet.open({
    head: itemHead(it),
    actions: [
      { id: 'room', label: hasPlace(it) ? 'Ort ändern' : 'Ort zuweisen', icon: 'pin' },
      { id: 'rename', label: it.name ? 'Umbenennen' : 'Benennen', icon: 'pencil' },
      cleanOut(it.out) ? { id: 'back', label: 'Wieder da', icon: 'undo' } : { id: 'out', label: 'Unterwegs / verliehen', icon: 'out' },
      ...(state.view === 'list' || state.view === 'room' ? [{ id: 'select', label: 'Mehrere auswählen', icon: 'done' }] : []),
      { id: 'archive', label: 'Löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'room') whereSheet(it);
      else if (a === 'out') outSheet([id], itemHead(it));
      else if (a === 'back') { sheet.close(); setOut([id], null); }
      else if (a === 'select') { sheet.close(); startSelect(id); }
      else if (a === 'rename') {
        sheet.form({
          head: itemHead(it), title: it.name ? 'Umbenennen' : 'Benennen', label: 'Name', value: it.name || '',
          placeholder: 'z. B. Akkuschrauber',
          onSubmit: async (v) => {
            if (!v) { toast('Der Name darf nicht leer sein.', true); return false; }
            try {
              await db.patchItem(id, { name: v });
              await refreshItems();
              renderCurrent();
              toast('Umbenannt.');
            } catch (e) { toast(e.message, true); }
            return true;
          },
        });
      } else if (a === 'archive') {
        sheet.close();
        haptic();
        archiveWithUndo(id);
      }
    },
  });
}

// Löschen = in den Papierkorb (Feld `archived`) – mit „Rückgängig“ im Toast statt einer Rückfrage
// vorher. Wischt man mehrere nacheinander weg, sammelt der Toast sie („3 gelöscht“), jedes Wischen startet
// die 5 s neu, und Rückgängig holt alle zurück.
let undoBatch = null;   // { ids: [] } – gehört zum gerade stehenden Rückgängig-Toast
export async function archiveWithUndo(id) {
  const it = state.items.find(x => x.id === id);
  if (!it) return;
  try {
    await db.archiveItem(id);
    await refreshItems();
    renderCurrent();
    updateStorageInfo();
    const batch = undoBatch && toastAction?.batch === undoBatch && !$('#toast').hidden ? undoBatch : { ids: [] };
    if (!batch.ids.includes(id)) batch.ids.push(id);
    undoBatch = batch;
    const n = batch.ids.length;
    const msg = n > 1 ? `${n} gelöscht` : it.name ? `„${it.name}“ gelöscht.` : 'Gelöscht.';
    sound.play('swipe');
    toast(msg, false, {
      label: 'Rückgängig',
      batch,
      run: async () => {
        if (undoBatch === batch) undoBatch = null;
        try {
          for (const x of batch.ids) await db.restoreItem(x);
          sound.play('undo');
          await refreshItems();
          renderCurrent();
          updateStorageInfo();
          queue.kick();
        } catch (e) { toast(e.message, true); }
      },
    });
  } catch (e) {
    toast(e.message, true);
    renderCurrent();
  }
}

// Unterwegs / verliehen – für einen oder mehrere Einträge.
export function outSheet(ids, head) {
  const sel = { type: 'verliehen' };
  const chip = (t, label) => `<button type="button" class="pchip${t === sel.type ? ' on' : ''}" data-out-type="${t}" aria-pressed="${t === sel.type}"><span>${label}</span></button>`;
  sheet.panel({
    head, title: 'Unterwegs / verliehen', submit: 'Übernehmen', focus: '#sheet-input',
    html: `<div class="pchips out-types" role="group" aria-label="Art">${chip('verliehen', 'Verliehen')}${chip('unterwegs', 'Unterwegs')}</div>
      <label class="field"><span id="out-lbl">An wen?</span>
        <input id="sheet-input" type="text" placeholder="z. B. Tom" autocomplete="off" enterkeyhint="done" maxlength="80">
      </label>`,
    onClick: (e) => {
      const b = e.target.closest('[data-out-type]');
      if (!b) return;
      sel.type = b.dataset.outType;
      for (const x of $$('#sheet [data-out-type]')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
      $('#out-lbl').textContent = sel.type === 'verliehen' ? 'An wen?' : 'Wohin? (optional)';
      $('#sheet-input').placeholder = sel.type === 'verliehen' ? 'z. B. Tom' : 'z. B. Urlaub, Büro';
    },
    onSubmit: (v) => setOut(ids, { type: sel.type, to: v, since: Date.now() }),
  });
}

// out = null: „Wieder da“. Eine Transaktion für alle.
export async function setOut(ids, out) {
  const clean = out ? cleanOut(out) : null;
  try {
    await db.patchItems(ids, { out: clean });
    await refreshItems();
    endSelect();
    renderCurrent();
    haptic();
    const one = ids.length === 1 ? state.items.find(x => x.id === ids[0]) : null;
    toast(!clean ? (one?.name ? `„${one.name}“ ist wieder da.` : 'Wieder da.')
      : one ? `${one.name ? `„${one.name}“: ` : ''}${outText(one)}.` : `${plural(ids.length, 'Ding', 'Dinge')} ${clean.type}.`);
  } catch (e) { toast(e.message, true); }
  return true;
}

// --- Mehrfachauswahl (Alles, Raum, Ort) ---
function startSelect(id) {
  state.sel = new Set(id ? [id] : []);
  closeSwipes();
  document.body.classList.add('selecting');
  renderSelBar();
  renderCurrent();
}
export function endSelect(render = true) {
  if (!state.sel) return;
  state.sel = null;
  document.body.classList.remove('selecting');
  renderSelBar();
  if (render) renderCurrent();
}
export function toggleSel(id) {
  if (!state.sel) return;
  if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
  haptic();
  for (const row of $$(`.row[data-id="${CSS.escape(id)}"]`)) {
    row.classList.toggle('sel-on', state.sel.has(id));
    row.setAttribute('aria-pressed', String(state.sel.has(id)));
  }
  renderSelBar();
}
function renderSelBar() {
  const on = !!state.sel;
  $('#sel-bar').hidden = !on;
  for (const b of $$('[data-select-toggle]')) { b.textContent = on ? 'Fertig' : 'Auswählen'; b.classList.toggle('strong', on); }
  if (!on) return;
  const n = state.sel.size;
  $('#sel-n').textContent = n ? `${plural(n, 'Ding', 'Dinge')} ausgewählt` : 'Dinge antippen zum Auswählen';
  for (const b of $$('#sel-bar [data-sel]')) b.disabled = !n;
}
const selIds = () => [...(state.sel || [])].filter(id => state.items.some(x => x.id === id && !x.archived));

export async function moveSelected(ids, pid, name) {
  if (!pid && !String(name || '').trim()) { toast('Bitte einen Ort wählen.', true); return false; }
  try {
    const where = await resolveWhere(pid, name);
    await db.moveItems(ids, where.placeId, where.roomId);
    await reloadAll();
    hideCombo();
    endSelect();
    haptic();
    toast(`${plural(ids.length, 'Ding', 'Dinge')} → ${whereText(where.placeId, where.roomId)}`);
  } catch (e) { toast('Verschieben fehlgeschlagen: ' + e.message, true); }
  return true;
}

function onSelAction(a) {
  const ids = selIds();
  if (!ids.length) return;
  const head = `<span class="sh-txt"><b>${esc(plural(ids.length, 'Ding', 'Dinge'))}</b><small>ausgewählt</small></span>`;
  if (a === 'where') whereSheet(state.items.find(x => x.id === ids[0]), ids);
  else if (a === 'out') outSheet(ids, head);
  else if (a === 'cat') {
    sheet.form({
      head, title: 'Kategorie ändern', label: 'Kategorie', combo: 'categories', placeholder: 'z. B. Werkzeug – leer: keine',
      onSubmit: async (v) => {
        try {
          const cid = v ? await db.ensureNamed('categories', v) : null;
          await db.patchItems(ids, { categoryId: cid });
          await refreshItems();
          endSelect();
          haptic();
          toast(`${plural(ids.length, 'Ding', 'Dinge')}: ${v || 'ohne Kategorie'}`);
        } catch (e) { toast(e.message, true); }
        return true;
      },
    });
  } else if (a === 'archive') archiveMany(ids);
}

async function archiveMany(ids) {
  try {
    await db.patchItems(ids, { archived: 1, archivedAt: Date.now() });
    await refreshItems();
    endSelect();
    updateStorageInfo();
    haptic();
    sound.play('swipe');
    toast(`${ids.length} gelöscht`, false, {
      label: 'Rückgängig',
      run: async () => {
        try {
          await db.patchItems(ids, { archived: 0, archivedAt: null });
          sound.play('undo');
          await refreshItems();
          renderCurrent();
          updateStorageInfo();
        } catch (e) { toast(e.message, true); }
      },
    });
  } catch (e) { toast(e.message, true); }
}

// Bestand + / − direkt in der Zeile (nur ganze Zahlen).
export async function stepQty(id, delta) {
  try {
    const it = await db.stepQuantity(id, delta);
    if (!it) return;
    haptic();
    const mine = state.items.find(x => x.id === id);
    if (mine) mine.quantity = it.quantity;
    for (const q of $$(`.row[data-id="${CSS.escape(id)}"] .qty-step .qty`)) q.textContent = it.quantity;
  } catch (e) { toast(e.message, true); }
}

// --- Checkliste je Ort: „Gehört hierher immer“ ---
// Ein Eintrag gehört zu dem Ort, an dem er markiert wurde (homePlaceId), sonst zu seinem jetzigen.
const checkPlaceOf = (it) => placeById(it.homePlaceId)?.id || placeOf(it)?.id || '';
export const checkItems = (pid) => state.items.filter(it => !it.archived && it.essential && checkPlaceOf(it) === pid);

export function checklistSheet(pid) {
  const p = placeById(pid);
  if (!p) return;
  if (!state.checks.has(pid)) state.checks.set(pid, new Set());
  const done = state.checks.get(pid);
  const draw = () => {
    const items = checkItems(pid).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
    const n = items.filter(it => done.has(it.id)).length;
    const rows = items.map((it) => {
      const on = done.has(it.id);
      // Nicht abgehakt: wo er zuletzt war – unterwegs, anderer Ort, Raum, genauer Platz.
      const where = outText(it) || [whereOf(it, ' › '), it.locationDetail].filter(Boolean).join(' · ') || 'Ohne Ort';
      return `<button type="button" class="check-row${on ? ' on' : ''}" data-check="${esc(it.id)}" aria-pressed="${on}">
        <span class="ck">${icon('check')}</span>
        <span class="ck-txt"><b>${esc(it.name || 'Unbenannt')}</b>${on ? '' : `<small>${esc(where)}</small>`}</span></button>`;
    }).join('');
    $('#sheet-check').innerHTML = items.length
      ? `<div class="ck-head"><p class="ck-sum">${n} von ${items.length} dabei</p><button type="button" class="btn pill ghost" data-check-reset>Alles zurücksetzen</button></div><div class="ck-list">${rows}</div>`
      : '<p class="hint">Noch nichts auf der Checkliste. Öffne einen Eintrag und schalte unter „Mehr Angaben“ „Gehört immer hierher“ ein.</p>';
  };
  sheet.panel({
    head: placeHead(p), title: 'Checkliste', submit: 'Fertig',
    html: '<div id="sheet-check" class="checklist"></div>',
    onClick: (e) => {
      if (e.target.closest('[data-check-reset]')) { done.clear(); draw(); return; }
      const b = e.target.closest('[data-check]');
      if (!b) return;
      const id = b.dataset.check;
      if (done.has(id)) done.delete(id); else done.add(id);
      haptic();
      // Häkchen – und wenn damit alles dabei ist, ein kleiner Akkord.
      if (done.has(id)) sound.play(checkItems(pid).every(x => done.has(x.id)) ? 'chord' : 'check');
      draw();
    },
    onSubmit: () => true,
  });
  draw();
}

// --- „Habe ich das schon?“: Foto → KI benennt → lokale Suche. Das Foto wird nicht gespeichert. ---
async function haveCheck(file) {
  if (!file) return;
  if (!hasKey()) { keyHint('Dafür brauchst du einen API-Key in den Einstellungen.'); return; }
  let src = null;
  toast('Foto wird erkannt …');
  try {
    src = await img.decode(file);
    const b64 = await img.blobToBase64(await img.toBlob(src, 1024, 0.8));
    img.release(src);
    src = null;
    const found = await ai.analyzePhoto(state.settings, b64, '', state.cats.map(c => c.name));
    const names = found.map(f => f.name).filter(Boolean);
    const hits = findSimilar(state.items, names);
    hideToast();
    haveSheet(names, hits);
  } catch (e) {
    toast(e.message, true);
  } finally {
    img.release(src);
  }
}

function haveSheet(names, hits) {
  const groups = new Map();
  for (const h of hits) {
    const w = outText(h.item) || whereShort(h.item) || 'Ohne Ort';
    groups.set(w, (groups.get(w) || 0) + 1);
  }
  const sum = hits.length ? 'Ja: ' + [...groups].map(([w, n]) => `${n}× ${w}`).join(', ') : 'Nichts gefunden';
  sheet.panel({
    title: 'Habe ich das schon?', submit: 'OK',
    html: `<p class="have-names">Erkannt: ${esc(names.join(', ') || '–')}</p>
      <p class="have-sum ${hits.length ? 'yes' : 'no'}">${icon(hits.length ? 'done' : 'search')}<span>${esc(sum)}</span></p>
      ${hits.length ? `<div class="list have-list">${hits.slice(0, 8).map(h => rowHTML(h.item, '', { noStep: true })).join('')}</div>`
        : '<p class="hint">In deinem Bestand steht nichts mit ähnlichem Namen.</p>'}`,
    onClick: (e) => {
      const row = e.target.closest('.row');
      if (!row) return;
      e.preventDefault();
      sheet.close();
      openItem(row.dataset.id);
    },
    onSubmit: () => true,
  });
}

export function init() {
  for (const b of $$('[data-select-toggle]')) b.addEventListener('click', () => (state.sel ? endSelect() : startSelect()));
  $('#sel-bar').addEventListener('click', (e) => { const b = e.target.closest('[data-sel]'); if (b && !b.disabled) onSelAction(b.dataset.sel); });
  const haveOpen = () => $('#have-input').click();
  $('#have-btn').addEventListener('click', haveOpen);
  $('#have-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    haveCheck(f).finally(() => { e.target.value = ''; });
  });
  $('#room-check').addEventListener('click', (e) => checklistSheet(e.currentTarget.dataset.place));
}
