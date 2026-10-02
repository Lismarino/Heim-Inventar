// Dokumente – der digitale Aktenschrank (1.9.0).
// Seit 2.0 ein eigener Tab („docs“): oben großer Titel und „+“ (Scannen, Fotos, Datei, Neuer
// Ordner); in einem Ordner „Zurück“ eine Ebene hoch (auch per Zurückwischen, js/nav.js).
// Ordner mit Unterordnern; Dokumente liegen im Store „docs“ (derselbe wie die Belege aus 1.8.0):
// ein Dokument hat Ordner UND/ODER Eintrag. Virtuelle Ordner: „Belege zu Einträgen“ (nur mit
// Eintrag verknüpft) und „Papierkorb“. Hier wird nur gezeichnet und bedient; die Daten kommen
// aus db.js, Aufbereitung und PDF aus scan.js.
import * as db from './db.js';
import * as sheet from './sheet.js';
import { esc, icon, plural } from './ui.js';
import { norm } from './combo.js';
import { fmtDate, daysUntil, cleanDate, localDay } from './match.js';
import { prepareDoc, docURL, isImageDoc, docSize, DOC_MAX, FOLDER_SUGGESTIONS, DUE_KINDS, cleanTags, titleFromName, shareName, ix, loadIndex, liveDocs, folderById, folderPath } from './docs.js';
import { renderPage, makePdf } from './scan.js';

const $ = (s) => document.querySelector(s);
const ITEM_DOCS = '@item';
const TRASH = '@trash';
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

// { state, navigate(view), toast(msg, err, action), haptic(), openLightbox(url, own), openItem(id), itemById(id), items(), onChange() }
let ctx = null;
const cab = {
  at: null,        // offener Ordner: null (oben), Ordner-ID, ITEM_DOCS oder TRASH
  // Hinzufügen/Bearbeiten
  edit: null,      // ID beim Bearbeiten, sonst null
  pages: [],       // [{ file, url, rotate }]
  scanned: false,
  file: null,      // gewählte Einzeldatei (PDF/Bild)
  saving: false,
  current: null,   // zuletzt im Blatt geöffnetes Dokument (mit Datei – fürs Teilen im selben Tipp)
};

export function init(c) { ctx = c; }

// Metadaten (Ordner, Dokumente ohne Datei) und die schlanken Abfragen für Zuhause, Suche und
// KI liegen seit 1.10.0 in docs.js (ix) – dieses Modul lädt die App erst beim Öffnen.
const load = loadIndex;

/* ---------------- Helfer ---------------- */

const children = (pid) => ix.folders.filter(f => (f.parentId || null) === (pid || null))
  .sort((a, b) => collator.compare(a.name, b.name));
const live = liveDocs;

// Alle Ordner als Liste mit Einrückung (für Auswahllisten), Eltern vor Kindern.
function folderTree(skip = null) {
  const out = [];
  const walk = (pid, depth) => {
    for (const f of children(pid)) {
      if (f.id === skip) continue;
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
const descendants = (id) => {
  const set = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const f of ix.folders) if (!set.has(f.id) && set.has(f.parentId)) { set.add(f.id); grew = true; } }
  return set;
};
const countIn = (id) => {
  const ids = descendants(id);
  return live().filter(d => ids.has(d.folderId)).length;
};

const whenText = (n) => (n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`);
const dueLine = (d) => {
  if (!cleanDate(d.due)) return '';
  const n = daysUntil(d.due);
  const soon = n != null && n <= 30;
  return `<span class="d-due${soon ? ' soon' : ''}">${esc((DUE_KINDS[d.dueKind] || 'Frist') + ' ' + fmtDate(d.due))}${soon && n >= 0 ? ` · ${whenText(n)}` : n < 0 ? ' · vorbei' : ''}</span>`;
};

/* ---------------- Übersicht ---------------- */

/** Für den Tab: Daten schon geladen? Sonst laden (reload). */
export const ready = () => ix.loaded;
export const reload = () => load();
/** Steht man in einem Ordner (oder in einer Suche), aus dem „Zurück“ eine Ebene hoch führt? */
export const canUp = () => !!cab.at || !!$('#docs-q').value.trim();
/** Tab erneut angetippt: ganz nach oben. */
export function toTop() { cab.at = null; $('#docs-q').value = ''; }

/** „+“ oben rechts: Scannen, Fotos, Datei – oder ein neuer Ordner (nicht in „Belege“/Papierkorb). */
export function addMenu() {
  const inFolder = cab.at && cab.at !== ITEM_DOCS && cab.at !== TRASH ? folderById(cab.at) : null;
  sheet.open({
    head: `<span class="sh-pic ph ph-none">${icon('docs')}</span><span class="sh-txt"><b>${esc(inFolder ? inFolder.name : 'Dokumente')}</b><small>Neues Dokument${inFolder ? ' in diesem Ordner' : ''}</small></span>`,
    actions: [
      { id: 'scan', label: 'Scannen', icon: 'scan' },
      { id: 'photos', label: 'Aus Fotos', icon: 'photos' },
      { id: 'file', label: 'PDF oder Datei', icon: 'doc' },
      ...(cab.at === ITEM_DOCS ? [] : [{ id: 'folder', label: inFolder ? 'Neuer Unterordner' : 'Neuer Ordner', icon: 'folder' }]),
    ],
    onAction: (a) => {
      if (a === 'folder') { newFolder(); return; }
      // Die Auswahl muss direkt im Tipp aufgehen (iOS) – das Formular folgt, sobald etwas gewählt ist.
      // Erst schließen: solange das Blatt offen ist, ist der Rest der App inert.
      sheet.close();
      $(`#da-${a}-input`).click();
    },
  });
}

/** Aus dem „+“-Blatt gewählt: Formular öffnen (falls noch nicht offen) und Seiten/Datei übernehmen. */
export async function addChosen(files, kind) {
  if (!files.length) return;
  if (ctx.state.view !== 'docadd') await openAdd();
  if (kind === 'file' && /pdf/i.test(files[0].type || files[0].name)) setFile(files[0]);
  else addPages(files, kind === 'scan');
}

function suggestSheet() {
  const html = `<p class="hint lead">Womit möchtest du anfangen? Abwählen, was du nicht brauchst – Ordner lassen sich jederzeit anlegen, umbenennen und löschen.</p>
    <div class="da-suggest">${FOLDER_SUGGESTIONS.map((n, i) => `<label class="check"><input type="checkbox" name="sg" value="${i}" checked> <span>${esc(n)}</span></label>`).join('')}</div>`;
  sheet.panel({
    title: 'Ordner vorschlagen',
    html,
    submit: 'Ordner anlegen',
    onSubmit: async (_v, form) => {
      const chosen = [...form.querySelectorAll('input[name="sg"]:checked')].map(x => FOLDER_SUGGESTIONS[Number(x.value)]);
      const now = Date.now();
      try {
        for (let i = 0; i < chosen.length; i++) await db.put('folders', { id: db.uid(), name: chosen[i], parentId: null, createdAt: now, order: i });
        await db.setSetting('docsSetup', true);
        ctx.state.settings.docsSetup = true;
        await load();
        render();
      } catch (e) { ctx.toast(e.message, true); return false; }
    },
  });
}

export function render() {
  if (!ix.loaded) return;
  const q = norm($('#docs-q').value);
  // Jedes Wort muss irgendwo vorkommen („versicherung kfz“ findet „Versicherungen › Kfz“).
  const words = q.split(/\s+/).filter(Boolean);
  const hit = (text) => { const h = norm(text); return words.every(w => h.includes(w)); };
  const at = cab.at;
  if (at && at !== ITEM_DOCS && at !== TRASH && !folderById(at)) cab.at = null;
  const f = folderById(cab.at);
  const title = cab.at === ITEM_DOCS ? 'Belege an Dingen' : cab.at === TRASH ? 'Papierkorb' : f ? f.name : 'Dokumente';
  $('#docs-title').textContent = q ? 'Suche' : title;
  // Oben: großer Titel wie die anderen Tabs; in einem Ordner (oder einer Suche) schmale Leiste mit „Zurück“.
  const sub = !!cab.at;
  $('#docs-bar').classList.toggle('large', !sub);
  $('#docs-back').hidden = !sub;
  document.body.classList.toggle('docs-sub', sub);
  const up = f ? (folderById(f.parentId)?.name || 'Dokumente') : 'Dokumente';
  $('#docs-back-txt').textContent = up;
  $('#docs-back').setAttribute('aria-label', `Zurück zu ${up}`);
  const path = f ? folderPath(f.parentId) : '';
  $('#docs-path').hidden = !path || !!q;
  $('#docs-path').textContent = path;
  $('#docs-new').hidden = cab.at === TRASH;

  let rows = '';
  let empty = '';
  if (q) {
    // Lokale Suche über Titel, Ordnerpfad, Stichworte und verknüpften Eintrag.
    const hay = (d) => [d.name, folderPath(d.folderId), (d.tags || []).join(' '), ctx.itemById(d.itemId)?.name, fmtDate(d.date)].join(' ');
    const fl = ix.folders.filter(x => hit(folderPath(x.id))).sort((a, b) => collator.compare(folderPath(a.id), folderPath(b.id)));
    const ds = live().filter(d => hit(hay(d))).sort(byDate);
    rows = fl.map(x => folderRow(x, true)).join('') + ds.map(d => docRow(d, true)).join('');
    empty = `<span class="empty-badge muted">${icon('search')}</span><p>Keine Dokumente gefunden.</p>`;
  } else if (cab.at === TRASH) {
    rows = ix.docs.filter(d => d.trashedAt).sort((a, b) => b.trashedAt - a.trashedAt).map(d => docRow(d, true)).join('');
    empty = `<span class="empty-badge muted">${icon('trash')}</span><p>Der Papierkorb ist leer.</p>`;
  } else if (cab.at === ITEM_DOCS) {
    rows = live().filter(d => d.itemId && !d.folderId).sort(byDate).map(d => docRow(d)).join('');
    empty = `<span class="empty-badge muted">${icon('doc')}</span><p>Noch keine Belege an Dingen.</p>`;
  } else {
    const subs = children(cab.at).map(x => folderRow(x)).join('');
    let virt = '';
    if (!cab.at) {
      const nItem = live().filter(d => d.itemId && !d.folderId).length;
      const nTrash = ix.docs.filter(d => d.trashedAt).length;
      if (nItem) virt += `<button type="button" class="row drow" data-folder="${ITEM_DOCS}"><span class="d-ic sage">${icon('box')}</span><span class="body"><span class="name">Belege an Dingen</span><span class="meta">${plural(nItem, 'Dokument', 'Dokumente')}</span></span>${icon('chev-r', 'go')}</button>`;
      if (nTrash) virt += `<button type="button" class="row drow" data-folder="${TRASH}"><span class="d-ic muted">${icon('trash')}</span><span class="body"><span class="name">Papierkorb</span><span class="meta">${plural(nTrash, 'Dokument', 'Dokumente')}</span></span>${icon('chev-r', 'go')}</button>`;
    }
    const docs = live().filter(d => (d.folderId || null) === (cab.at || null) && (cab.at || !d.itemId)).sort(byDate).map(d => docRow(d)).join('');
    rows = subs + virt + docs;
    // Noch keine Ordner: Vorschläge anbieten (auch wenn schon Belege an Einträgen hängen).
    if (rows && !cab.at && !ix.folders.length) rows = `<div class="docs-suggest"><span>Noch keine Ordner.</span><button type="button" class="btn pill" data-suggest>Ordner vorschlagen</button></div>` + rows;
    // 1.10.0: Ordnervorschläge nicht mehr ungefragt – nur auf Wunsch aus dem leeren Zustand.
    const suggest = !cab.at && !ix.folders.length ? '<button type="button" class="btn pill" data-suggest>Ordner vorschlagen</button>' : '';
    empty = `<span class="empty-badge muted">${icon('folder')}</span><p>${cab.at ? 'Dieser Ordner ist leer.' : 'Noch keine Dokumente.'}</p><p class="hint">Scanne einen Brief, wähle Fotos oder ein PDF aus der Dateien-App.</p>${suggest}`;
  }
  $('#docs-list').innerHTML = rows;
  $('#docs-empty').hidden = !!rows;
  $('#docs-empty').innerHTML = rows ? '' : empty;
}

const byDate = (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.createdAt || 0) - (a.createdAt || 0);

function folderRow(f, withPath = false) {
  const n = countIn(f.id);
  const subs = children(f.id).length;
  const meta = [n ? plural(n, 'Dokument', 'Dokumente') : 'leer', subs ? plural(subs, 'Ordner', 'Ordner') : ''].filter(Boolean).join(' · ');
  const path = withPath ? folderPath(f.parentId) : '';
  return `<button type="button" class="row drow" data-folder="${esc(f.id)}">
    <span class="d-ic">${icon('folder')}</span>
    <span class="body"><span class="name">${esc(f.name)}</span><span class="meta">${esc(path ? path + ' · ' + meta : meta)}</span></span>
    <span class="d-more" role="button" tabindex="0" data-folder-menu="${esc(f.id)}" aria-label="Ordner „${esc(f.name)}“ bearbeiten">${icon('more')}</span>
  </button>`;
}

function docRow(d, withPath = false) {
  const kind = isImageDoc(d) ? 'Bild' : 'PDF';
  const where = withPath ? (folderPath(d.folderId) || (d.itemId ? 'Beleg' : '')) : '';
  const item = d.itemId ? ctx.itemById(d.itemId) : null;
  const meta = [fmtDate(d.date) || fmtDate(localDay(d.createdAt || Date.now())), kind, docSize(d)].join(' · ');
  const tags = (d.tags || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  return `<button type="button" class="row drow" data-doc="${esc(d.id)}">
    <span class="d-ic ${isImageDoc(d) ? 'img' : 'pdf'}">${icon(isImageDoc(d) ? 'photos' : 'doc')}</span>
    <span class="body"><span class="name">${esc(d.name)}</span>
      <span class="meta">${esc(where ? where + ' · ' + meta : meta)}</span>
      ${tags || item ? `<span class="d-tags">${tags}${item ? `<span class="d-item">${icon('box')}${esc(item.name || 'Unbenannt')}</span>` : ''}</span>` : ''}
      ${dueLine(d)}</span>
  </button>`;
}

/** Zurück oben links: aus einem Unterordner eine Ebene hoch, sonst die Ansicht verlassen. */
export function up() {
  if ($('#docs-q').value.trim()) { $('#docs-q').value = ''; render(); return; }
  const f = folderById(cab.at);
  if (f) { cab.at = f.parentId || null; render(); scrollTop(); return; }
  if (cab.at) { cab.at = null; render(); scrollTop(); }
}
const scrollTop = () => { const sc = $('#view-docs .scroll'); if (sc) sc.scrollTop = 0; };

export function onClick(e) {
  if (e.target.closest('[data-suggest]')) { suggestSheet(); return; }
  const menu = e.target.closest('[data-folder-menu]');
  if (menu) { e.stopPropagation(); folderMenu(menu.dataset.folderMenu); return; }
  const fo = e.target.closest('[data-folder]');
  if (fo) { cab.at = fo.dataset.folder; $('#docs-q').value = ''; render(); scrollTop(); return; }
  const d = e.target.closest('[data-doc]');
  if (d) docSheet(d.dataset.doc);
}

/* ---------------- Ordner ---------------- */

function newFolder(parentId = cab.at && cab.at !== ITEM_DOCS && cab.at !== TRASH ? cab.at : null) {
  sheet.form({
    head: `<span class="sh-pic ph ph-none">${icon('folder')}</span><span class="sh-txt"><b>${esc(parentId ? 'In „' + (folderById(parentId)?.name || '') + '“' : 'Dokumente')}</b></span>`,
    title: 'Neuer Ordner', label: 'Name', placeholder: 'z. B. Hausrat', submit: 'Anlegen',
    onSubmit: async (v) => {
      const name = String(v || '').trim().slice(0, 80);
      if (!name) return false;
      if (children(parentId).some(f => norm(f.name) === norm(name))) { ctx.toast(`„${name}“ gibt es hier schon.`, true); return false; }
      await db.put('folders', { id: db.uid(), name, parentId, createdAt: Date.now(), order: ix.folders.length });
      await load();
      render();
      ctx.haptic();
    },
  });
}

function folderMenu(id) {
  const f = folderById(id);
  if (!f) return;
  sheet.open({
    head: `<span class="sh-pic ph ph-none">${icon('folder')}</span><span class="sh-txt"><b>${esc(f.name)}</b><small>${esc(folderPath(f.parentId) || 'Dokumente')}</small></span>`,
    actions: [
      { id: 'rename', label: 'Umbenennen', icon: 'pencil' },
      { id: 'sub', label: 'Unterordner anlegen', icon: 'plus' },
      { id: 'move', label: 'Verschieben', icon: 'folder' },
      { id: 'del', label: 'Löschen', icon: 'trash', danger: true },
    ],
    onAction: (a) => {
      if (a === 'rename') {
        sheet.form({ title: 'Ordner umbenennen', label: 'Name', value: f.name, onSubmit: async (v) => {
          const name = String(v || '').trim().slice(0, 80);
          if (!name) return false;
          if (children(f.parentId).some(x => x.id !== f.id && norm(x.name) === norm(name))) { ctx.toast(`„${name}“ gibt es hier schon.`, true); return false; }
          await db.put('folders', { ...f, name });
          await load(); render();
        } });
      } else if (a === 'sub') newFolder(f.id);
      else if (a === 'move') {
        const skip = descendants(f.id);
        const opts = [{ id: '', name: 'Dokumente (oberste Ebene)', depth: 0 }, ...folderTree().filter(x => !skip.has(x.id))];
        pickFolder('Ordner verschieben', `„${f.name}“ kommt nach …`, opts, f.parentId || '', async (target) => {
          if (children(target || null).some(x => x.id !== f.id && norm(x.name) === norm(f.name))) { ctx.toast(`Dort gibt es schon „${f.name}“.`, true); return false; }
          await db.put('folders', { ...f, parentId: target || null });
          await load(); render();
          ctx.toast(`„${f.name}“ verschoben.`);
        });
      } else if (a === 'del') {
        const n = countIn(f.id);
        const subs = descendants(f.id).size - 1;
        const what = [subs ? plural(subs, 'Unterordner', 'Unterordner') : '', n ? plural(n, 'Dokument', 'Dokumente') : ''].filter(Boolean).join(' und ');
        if (!confirm(`Ordner „${f.name}“ löschen?${what ? `\n\nDarin: ${what}. Dokumente kommen in den Papierkorb (Belege bleiben an ihrem Ding).` : ''}`)) return;
        db.dropFolder(f.id).then(async () => {
          if (descendants(f.id).has(cab.at)) cab.at = f.parentId || null;
          await load(); render();
          ctx.toast(`„${f.name}“ gelöscht.`);
        }).catch(e => ctx.toast(e.message, true));
      }
    },
  });
}

function pickFolder(title, label, opts, value, onPick) {
  const html = `<label class="field"><span>${esc(label)}</span><select id="sheet-folder">${opts.map(o => `<option value="${esc(o.id)}"${o.id === value ? ' selected' : ''}>${' '.repeat(o.depth)}${esc(o.name)}</option>`).join('')}</select></label>`;
  sheet.panel({ title, html, submit: 'Verschieben', onSubmit: async (_v, form) => onPick(form.querySelector('#sheet-folder').value) });
}

/* ---------------- Dokument: Blatt mit Aktionen ---------------- */

export async function docSheet(id) {
  let d;
  try { d = await db.get('docs', id); } catch (e) { ctx.toast(e.message, true); return; }
  if (!d) { ctx.toast('Das Dokument gibt es nicht mehr.', true); await load(); render(); return; }
  cab.current = d;   // mit Datei – Teilen muss direkt im Tipp passieren (iOS)
  const item = d.itemId ? ctx.itemById(d.itemId) : null;
  const where = folderPath(d.folderId) || (item ? 'Beleg' : 'Dokumente');
  const actions = d.trashedAt
    ? [{ id: 'view', label: 'Ansehen', icon: 'expand' }, { id: 'restore', label: 'Wiederherstellen', icon: 'undo' }, { id: 'purge', label: 'Endgültig löschen', icon: 'trash', danger: true }]
    : [
      { id: 'view', label: 'Ansehen', icon: 'expand' },
      { id: 'share', label: 'Teilen', icon: 'share' },
      // 2.0: Titel und Ordner ändert „Bearbeiten“ (früher zusätzlich „Umbenennen“ und „Verschieben“).
      { id: 'edit', label: 'Bearbeiten', icon: 'pencil' },
      ...(item ? [{ id: 'item', label: `Zum Ding „${item.name || 'Unbenannt'}“`, icon: 'box' }] : []),
      { id: 'trash', label: 'In den Papierkorb', icon: 'trash', danger: true },
    ];
  sheet.open({
    head: `<span class="sh-pic ph ph-none">${icon(isImageDoc(d) ? 'photos' : 'doc')}</span><span class="sh-txt"><b>${esc(d.name)}</b><small>${esc(where)} · ${esc(docSize(d))}</small></span>`,
    actions,
    onAction: (a) => docAction(a, d),
  });
}

async function docAction(a, d) {
  // Aktionen ohne eigenes Folge-Blatt schließen das Blatt selbst (Teilen erst NACH dem Aufruf –
  // iOS lässt das Teilen-Fenster nur direkt im Tipp zu).
  if (a !== 'share') sheet.close();
  try {
    if (a === 'view') show(d);
    else if (a === 'share') { const p = share(d); sheet.close(); await p; }
    else if (a === 'edit') openEditor(d);
    else if (a === 'item') ctx.openItem(d.itemId);
    else if (a === 'trash') {
      await db.patchDoc(d.id, { trashedAt: Date.now() });
      await changed();
      ctx.toast(`„${d.name}“ liegt im Papierkorb.`, false, { label: 'Rückgängig', run: async () => { await db.patchDoc(d.id, { trashedAt: null }); await changed(); } });
    } else if (a === 'restore') {
      // Der Ordner kann inzwischen gelöscht sein: dann oben einsortieren.
      await db.patchDoc(d.id, { trashedAt: null, folderId: folderById(d.folderId) ? d.folderId : null });
      await changed();
      ctx.toast(`„${d.name}“ ist wieder da.`);
    } else if (a === 'purge') {
      if (!confirm(`„${d.name}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
      await db.delDoc(d.id);
      await changed();
      ctx.toast('Endgültig gelöscht.');
    }
  } catch (e) { ctx.toast(e.message, true); }
}

async function changed() {
  await load();
  if (ctx.state.view === 'docs') render();
  ctx.onChange();
}

/** Bild in der Lupe, PDF in Safaris Vorschau (neuer Tab), blockiert: laden. */
export function show(d) {
  const url = docURL(d);
  if (isImageDoc(d)) { ctx.openLightbox(url, true); return; }
  const w = window.open(url, '_blank');
  if (!w) {
    const a = document.createElement('a');
    a.href = url;
    a.download = shareName(d);
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function share(d) {
  const file = new File([d.buf], shareName(d), { type: d.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: d.name }); } catch (e) { if (e.name !== 'AbortError') throw e; }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

/* ---------------- Hinzufügen / Bearbeiten ---------------- */

function resetAdd() {
  for (const p of cab.pages) URL.revokeObjectURL(p.url);
  cab.pages = [];
  cab.file = null;
  cab.scanned = false;
  cab.edit = null;
}

function fillFolderSelect(value) {
  const sel = $('#da-folder');
  const opts = [{ id: '', name: 'Kein Ordner', depth: 0 }, ...folderTree()];
  sel.innerHTML = opts.map(o => `<option value="${esc(o.id)}">${' '.repeat(o.depth)}${esc(o.name)}</option>`).join('');
  sel.value = opts.some(o => o.id === value) ? value : '';
}

/** Neues Dokument. opts.itemId: gleich mit einem Eintrag verknüpfen. */
async function openAdd({ itemId = null } = {}) {
  if (!ix.loaded) await load();
  resetAdd();
  const inFolder = folderById(cab.at)?.id;
  const last = folderById(ctx.state.settings.docLastFolder)?.id;
  $('#da-head').textContent = 'Neues Dokument';
  $('#da-src').hidden = false;
  fillFolderSelect(inFolder || (itemId ? '' : last) || '');
  $('#da-title').value = '';
  $('#da-date').value = localDay();
  $('#da-tags').value = '';
  $('#da-due-kind').value = '';
  $('#da-due').value = '';
  $('#da-due-row').hidden = true;
  $('#da-item').value = itemId ? (ctx.itemById(itemId)?.name || '') : '';
  $('#da-enhance').checked = false;
  ctx.navigate('docadd');
}

function openEditor(d) {
  resetAdd();
  cab.edit = d.id;
  $('#da-head').textContent = 'Dokument';
  $('#da-src').hidden = true;
  fillFolderSelect(d.folderId || '');
  $('#da-title').value = d.name || '';
  $('#da-date').value = cleanDate(d.date);
  $('#da-tags').value = (d.tags || []).join(', ');
  $('#da-due-kind').value = DUE_KINDS[d.dueKind] ? d.dueKind : (d.due ? 'ablauf' : '');
  $('#da-due').value = cleanDate(d.due);
  $('#da-due-row').hidden = !$('#da-due-kind').value;
  $('#da-item').value = d.itemId ? (ctx.itemById(d.itemId)?.name || '') : '';
  ctx.navigate('docadd');
}

export function renderAdd() {
  const pages = cab.pages;
  const card = $('#da-pages-card');
  card.hidden = !pages.length;
  $('#da-pages').innerHTML = pages.map((p, i) => `<div class="da-page${$('#da-enhance').checked ? ' bw' : ''}">
      <img src="${esc(p.url)}" alt="Seite ${i + 1}" style="transform:rotate(${Number(p.rotate) || 0}deg)">
      <span class="da-n">${i + 1}</span>
      <button type="button" class="da-rot" data-page-rot="${i}" aria-label="Seite ${i + 1} drehen">${icon('rotate')}</button>
      <button type="button" class="da-del" data-page-del="${i}" aria-label="Seite ${i + 1} entfernen">${icon('close')}</button>
    </div>`).join('') + (pages.length ? `<button type="button" class="da-page da-more" data-page-add aria-label="Weitere Seite scannen">${icon('plus')}<span>Seite</span></button>` : '');
  $('#da-pages-hint').textContent = pages.length
    ? (asPdf() ? `${plural(pages.length, 'Seite', 'Seiten')} → ein PDF.` : 'Wird als Bild gespeichert.') + ' Tippe ⟳ zum Drehen.'
    : '';
  const f = cab.file;
  $('#da-filecard').hidden = !f;
  $('#da-filecard').innerHTML = f ? `<div class="doc-row"><span class="doc-open">${icon(/pdf/i.test(f.type || f.name) ? 'doc' : 'photos')}<span class="doc-txt"><b>${esc(f.name || 'Datei')}</b><small>${esc(docSize({ size: f.size }))}</small></span></span><button type="button" class="doc-del" data-file-del aria-label="Datei entfernen">${icon('close')}</button></div>` : '';
  $('#da-scan').querySelector('span').textContent = cab.scanned && pages.length ? 'Weitere Seite' : 'Scannen';
}

const asPdf = () => cab.scanned || cab.pages.length > 1;

function suggestTitle(name) {
  if ($('#da-title').value.trim()) return;
  const t = titleFromName(name);
  $('#da-title').value = t || `Scan ${fmtDate(localDay())}`;
}

/** Fotos/Scans als Seiten hinzufügen. */
function addPages(files, scanned) {
  const list = [...files].filter(f => String(f.type || '').startsWith('image/') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || ''));
  if (!list.length) return;
  if (cab.file) { cab.file = null; }
  for (const f of list) cab.pages.push({ file: f, url: URL.createObjectURL(f), rotate: 0 });
  if (scanned) cab.scanned = true;
  suggestTitle(scanned ? '' : list[0].name);
  renderAdd();
}

function setFile(file) {
  if (!file) return;
  for (const p of cab.pages) URL.revokeObjectURL(p.url);
  cab.pages = [];
  cab.scanned = false;
  cab.file = file;
  suggestTitle(file.name);
  renderAdd();
}

export function onAddClick(e) {
  const rot = e.target.closest('[data-page-rot]');
  if (rot) { const p = cab.pages[Number(rot.dataset.pageRot)]; if (p) { p.rotate = ((p.rotate || 0) + 90) % 360; renderAdd(); } return; }
  const del = e.target.closest('[data-page-del]');
  if (del) {
    const [p] = cab.pages.splice(Number(del.dataset.pageDel), 1);
    if (p) URL.revokeObjectURL(p.url);
    if (!cab.pages.length) cab.scanned = false;
    renderAdd();
    return;
  }
  if (e.target.closest('[data-page-add]')) { $('#da-scan-input').click(); return; }
  if (e.target.closest('[data-file-del]')) { cab.file = null; renderAdd(); }
}

/** Das Formular als Metadaten (gemeinsam für Neu und Bearbeiten). */
function formMeta() {
  const itemName = $('#da-item').value.trim();
  let itemId = null;
  if (itemName) {
    const hit = ctx.items().find(i => !i.archived && norm(i.name) === norm(itemName));
    if (!hit) throw new Error(`Kein Ding „${itemName}“ gefunden – Namen aus der Vorschlagsliste wählen oder leer lassen.`);
    itemId = hit.id;
  }
  const kind = $('#da-due-kind').value;
  const due = kind ? cleanDate($('#da-due').value) : '';
  if (kind && !due) throw new Error('Bitte das Datum der Frist eintragen.');
  return {
    name: $('#da-title').value.trim().slice(0, 120),
    folderId: $('#da-folder').value || null,
    date: cleanDate($('#da-date').value),
    tags: cleanTags($('#da-tags').value),
    due,
    dueKind: due ? kind : '',
    itemId,
  };
}

export async function save() {
  if (cab.saving) return;
  const btn = $('#da-save');
  let meta;
  try { meta = formMeta(); } catch (e) { ctx.toast(e.message, true); return; }
  cab.saving = true;
  btn.disabled = true;
  try {
    if (cab.edit) {
      if (!meta.name) throw new Error('Bitte einen Titel eingeben.');
      await db.patchDoc(cab.edit, meta);
    } else {
      const doc = await buildDoc(meta);
      await db.addDoc(doc);
      if (meta.folderId) { ctx.state.settings.docLastFolder = meta.folderId; db.setSetting('docLastFolder', meta.folderId).catch(() => {}); }
    }
    const was = cab.edit;
    resetAdd();
    await load();
    if (!was && meta.folderId && folderById(meta.folderId)) cab.at = meta.folderId;
    ctx.haptic();
    ctx.toast(was ? 'Gespeichert.' : 'Dokument gesichert.');
    ctx.onChange();
    ctx.navigate('back');
  } catch (e) {
    ctx.toast(e.message, true);
  } finally {
    cab.saving = false;
    btn.disabled = false;
    btn.textContent = 'Fertig';
  }
}

async function buildDoc(meta) {
  const now = Date.now();
  const btn = $('#da-save');
  let base;
  if (cab.pages.length) {
    const enhance = $('#da-enhance').checked;
    const imgMax = Number(ctx.state.settings.imgMax) || 1600;
    if (asPdf()) {
      const pages = [];
      for (let i = 0; i < cab.pages.length; i++) {
        btn.innerHTML = `<span class="spin"></span>${i + 1}/${cab.pages.length}`;
        const p = cab.pages[i];
        const r = await renderPage(p.file, { rotate: p.rotate, enhance, maxEdge: Math.max(imgMax, 1600) });
        pages.push({ bytes: new Uint8Array(await r.blob.arrayBuffer()), w: r.w, h: r.h });
      }
      const pdf = makePdf(pages, { title: meta.name });
      if (pdf.byteLength > DOC_MAX) throw new Error('Das PDF wäre größer als 10 MB – bitte weniger Seiten.');
      base = { type: 'application/pdf', buf: pdf.buffer };
    } else {
      const p = cab.pages[0];
      const r = await renderPage(p.file, { rotate: p.rotate, enhance, maxEdge: imgMax, quality: 0.82 });
      base = { type: 'image/jpeg', buf: await r.blob.arrayBuffer() };
    }
  } else if (cab.file) {
    const d = await prepareDoc(cab.file, null, ctx.state.settings.imgMax);
    base = { type: d.type, buf: d.buf };
  } else {
    throw new Error('Bitte zuerst scannen, Fotos oder eine Datei wählen.');
  }
  const name = meta.name || (cab.file ? titleFromName(cab.file.name) : '') || `Dokument ${fmtDate(localDay())}`;
  return { id: db.uid(), ...meta, name, ...base, createdAt: now, updatedAt: now, trashedAt: null };
}

