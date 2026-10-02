// Einstellungen (2.0, 2.1: + Darstellung): Sicherung · KI-Erkennung · Darstellung · Kategorien › · Töne · Über & Hilfe › · Erweitert ›
// (Google Drive, Modell, Bildgröße, Datenbank prüfen, Einführung). Unterseiten liegen in derselben Ansicht.
import * as db from './db.js';
import * as ai from './gemini.js';
import * as queue from './queue.js';
import * as sound from './sound.js';
import { ACCENTS, accentId, applyAccent } from './accent.js';
import { $, $$, esc, icon, plural } from './ui.js';
import { APP_VERSION } from './version.js';
import { navigate, renderCurrent } from './nav.js';
import { renderGdSettings } from './settings-backup.js';
import { hasKey, refreshItems, reloadAll, state } from './state.js';
import { toast } from './toast.js';
import { dropNamed, labelOf, renameNamed } from './view-room.js';

export function fillSettingsForm() {
  $('#set-key').value = state.settings.apiKey || '';
  selectModel(state.settings.model || db.DEFAULT_MODEL);
  $('#set-imgmax').value = String(state.settings.imgMax || 1600);
  $('#exp-encrypt').checked = !!state.settings.expEncrypt;
  $('#gd-client').value = state.settings.gdClientId || '';
  applySoundSettings();
  renderAccent();
  renderGdSettings();
}

// Darstellung (2.1): Akzentfarbe als Farbmuster mit Häkchen. Jedes Muster trägt selbst
// data-accent und zeigt so seine eigene Farbe (css/tokens.css).
function renderAccent() {
  const cur = applyAccent(state.settings.accent);
  $('#acc-row').innerHTML = ACCENTS.map((a) => `<button type="button" class="acc-sw" role="radio" data-accent="${a.id}" aria-checked="${a.id === cur}" aria-label="${esc(a.name)}"><span class="acc-dot">${icon('check')}</span></button>`).join('');
  $('#acc-name').textContent = ACCENTS.find((a) => a.id === cur).name;
}
async function pickAccent(id) {
  const a = accentId(id);
  if (a === accentId(state.settings.accent)) return;
  state.settings.accent = a;
  renderAccent();
  sound.play('tick');
  await db.setSetting('accent', a).catch((err) => console.warn('Farbe merken:', err));
}

// Töne (1.10.0): Standard an, Lautstärke 0,25. Einen Regler gibt es nicht mehr (1.11.0) – eine
// früher gewählte Lautstärke (soundVol) bleibt gespeichert und gilt weiter.
const soundVol = () => (typeof state.settings.soundVol === 'number' ? state.settings.soundVol : 0.25);
function applySoundSettings() {
  const on = state.settings.sound !== false;
  $('#set-sound').checked = on;
  sound.configure({ enabled: on, volume: soundVol() });
}

// Setzt die Auswahl und ergänzt den Eintrag, falls er in der Liste fehlt.
function selectModel(id) {
  const sel = $('#set-model');
  if (![...sel.options].some(o => o.value === id)) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(id)}">${esc(id)}</option>`);
  }
  sel.value = id;
}

// Neuer oder geänderter API-Key: speichern, Warteschlange neu starten und Fotos,
// die ohne Key erfasst wurden, jetzt erkennen lassen. Liefert die Zahl der vorgemerkten.
export async function applyKey(key) {
  state.settings.apiKey = key;
  await db.setSetting('apiKey', key);
  let marked = 0;
  if (key) {
    try {
      marked = await db.markUnrecognized();
    } catch (e) {
      console.warn('Vormerken zur Erkennung fehlgeschlagen:', e);
    }
    if (marked) await refreshItems();
  }
  queue.kick({ reset: true });
  renderCurrent();
  return marked;
}

/** Unterseite der Einstellungen zeigen ('' = Hauptseite). */
let spage = '';
/** Offene Unterseite der Einstellungen ('' = Hauptseite). */
export const settingsSub = () => spage;
export function settingsPage(name = '') {
  spage = name;
  let title = 'Einstellungen';
  $$('#view-settings .spage').forEach((p) => {
    const on = p.dataset.spage === name;
    p.hidden = !on;
    if (on && p.dataset.title) title = p.dataset.title;
  });
  $('#view-settings h1').textContent = title;
  const sc = $('#view-settings .scroll');
  if (sc) sc.scrollTop = 0;
}

/** „Zuletzt gesichert …“ und „KI-Erkennung: An/Aus“ oben in den Einstellungen. */
export function renderSettingsStatus() {
  const s = state.settings;
  const last = Math.max(Number(s.lastBackupAt) || 0, s.gdEnabled ? Number(s.gdLastSync) || 0 : 0);
  const days = last ? Math.floor((Date.now() - last) / 864e5) : 0;
  const el = $('#bk-last');
  el.textContent = !last ? 'Noch nie gesichert'
    : `Zuletzt gesichert ${days === 0 ? 'heute' : days === 1 ? 'gestern' : `vor ${days} Tagen`}`;
  el.classList.toggle('due', !last || days >= 7);
  $('#ai-state').textContent = hasKey() ? 'An – neue Fotos werden automatisch erkannt.' : 'Aus – ohne Key bleiben neue Fotos unbenannt.';
}

/** Zum API-Key in den Einstellungen springen (Feld mittig, fokussiert – iOS öffnet dann die Tastatur). */
export function goToKey() {
  navigate('settings');
  settingsPage('');
  const key = $('#set-key');
  key.scrollIntoView({ block: 'center' });
  key.focus({ preventScroll: true });
}

/** Ohne API-Key: ein freundlicher Hinweis (kein Fehler) mit „Einrichten“. */
export function keyHint(msg) {
  toast(msg, false, { label: 'Einrichten', icon: 'key', run: goToKey });
}

export const markedMsg = (n) => (n ? ` ${plural(n, 'Foto wird', 'Fotos werden')} jetzt erkannt.` : '');

async function loadModelList() {
  const out = $('#set-models-out');
  const key = $('#set-key').value.trim();
  if (key !== state.settings.apiKey) { const n = await applyKey(key); if (n) toast(markedMsg(n).trim()); }
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Lade Modellliste …';
  try {
    const models = await ai.listModels(state.settings);
    if (!models.length) throw new Error('Keine passenden Modelle gefunden.');
    const current = state.settings.model;
    $('#set-model').innerHTML = models
      .map(m => `<option value="${esc(m.id)}">${esc(m.id)}${m.label ? ` – ${esc(m.label)}` : ''}</option>`).join('');
    selectModel(current);
    out.className = 'hint ok';
    out.textContent = `${models.length} Modelle geladen. Bleib im Zweifel bei ${db.DEFAULT_MODEL} – nicht jedes gelistete Modell ist für neue Konten freigeschaltet.`;
  } catch (e) {
    out.className = 'hint err';
    out.textContent = e.message;
  }
}

// Einstellungen: nur noch Kategorien – Orte und Räume verwaltet der Tab „Räume“ (1.10.0).
export function renderManagers() {
  renderSettingsStatus();
  const usedCat = new Map();
  for (const it of state.items) {
    if (it.categoryId) usedCat.set(it.categoryId, (usedCat.get(it.categoryId) || 0) + 1);
  }
  const row = (r, used, kind) => `<div class="m" data-id="${esc(r.id)}" data-kind="${kind}">
          <input value="${esc(r.name)}" data-rename aria-label="${labelOf(kind)} umbenennen">
          <span class="cnt">${used.get(r.id) || 0}</span>
          <button data-drop aria-label="${labelOf(kind)} „${esc(r.name)}“ löschen">${icon('trash')}</button>
        </div>`;
  const none = (txt) => `<div class="none">${txt}</div>`;
  $('#cat-mgr').innerHTML = state.cats.length ? state.cats.map(r => row(r, usedCat, 'categories')).join('')
    : none('Noch nichts angelegt – entsteht automatisch beim Hinzufügen.');
}

export async function updateStorageInfo() {
  const n = state.items.filter(i => !i.archived).length;
  const a = state.items.filter(i => i.archived).length;
  let usage = '';
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.usage) usage = ` · belegt ca. ${(est.usage / 1048576).toFixed(1)} MB`;
    }
  } catch (_) { void _; }
  let persist = '';
  try {
    if (navigator.storage?.persisted) persist = (await navigator.storage.persisted()) ? ' · dauerhaft gesichert' : '';
  } catch (_) { void _; }
  $('#storage-info').textContent = `${plural(n + a, 'Ding', 'Dinge')}${a ? ` (davon ${a} im Papierkorb)` : ''}${usage}${persist}`;
}

async function runDiagnostics() {
  const out = $('#diag-out');
  out.className = 'hint';
  out.textContent = 'Prüfe …';
  try {
    const c = await db.rawCounts();
    const lines = [
      `Adresse: ${location.origin}${location.pathname}`,
      `Datenbank: ${c.items} Dinge, ${c.photos} Fotos, ${c.categories} Kategorien, ${c.places} Orte, ${c.rooms} Räume`,
      `Modus: ${window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'vom Home-Bildschirm' : 'im Browser'}`,
    ];
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      lines.push(`Datenbanken hier: ${dbs.map(d => d.name).filter(Boolean).join(', ') || 'keine'}`);
    }
    out.className = c.items > 0 ? 'hint ok' : 'hint';
    out.textContent = lines.join(' · ');
  } catch (e) {
    out.className = 'hint err';
    out.textContent = 'Prüfung fehlgeschlagen: ' + e.message;
  }
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persist && navigator.storage?.persisted) {
      if (!(await navigator.storage.persisted())) await navigator.storage.persist();
    }
  } catch (_) { void _; }
}

async function addNamed(kind, input) {
  const name = input.value.trim();
  if (!name) return;
  try {
    await db.ensureNamed(kind, name);
    input.value = '';
    await reloadAll();
    renderManagers();
    toast('Angelegt.');
  } catch (e) {
    toast(e.message, true);
  }
}

export function init() {
  $('#set-key').addEventListener('change', async (e) => {
    const key = e.target.value.trim();
    e.target.value = key;
    if (key === (state.settings.apiKey || '')) return;
    const n = await applyKey(key);   // liegen gebliebene Fotos jetzt erkennen
    toast(key ? 'API-Key gespeichert.' + markedMsg(n) : 'API-Key entfernt.');
    renderSettingsStatus();
  });
  $('#set-key-show').addEventListener('change', (e) => {
    $('#set-key').type = e.target.checked ? 'text' : 'password';
  });
  $('#set-model').addEventListener('change', async (e) => {
    state.settings.model = e.target.value;
    await db.setSetting('model', e.target.value);
    queue.kick({ reset: true });
  });
  // --- 2.1: Akzentfarbe ---
  $('#acc-row').addEventListener('click', (e) => {
    const b = e.target.closest('.acc-sw');
    if (b) pickAccent(b.dataset.accent);
  });
  // Pfeiltasten wie in einer Radiogruppe
  $('#acc-row').addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    e.preventDefault();
    const i = ACCENTS.findIndex((a) => a.id === accentId(state.settings.accent));
    const next = ACCENTS[(i + d + ACCENTS.length) % ACCENTS.length].id;
    pickAccent(next).then(() => $(`#acc-row [data-accent="${next}"]`)?.focus());
  });
  // --- 1.10.0: Töne ---
  $('#set-sound').addEventListener('change', async (e) => {
    state.settings.sound = e.target.checked;
    sound.configure({ enabled: e.target.checked, volume: soundVol() });
    if (e.target.checked) { sound.unlock(); sound.play('save'); }   // kurzer Beispielton
    await db.setSetting('sound', e.target.checked).catch((err) => console.warn('Töne merken:', err));
  });
  $('#set-imgmax').addEventListener('change', async (e) => {
    state.settings.imgMax = Number(e.target.value);
    await db.setSetting('imgMax', state.settings.imgMax).catch((err) => toast(err.message, true));
  });
  $('#diag-run').addEventListener('click', runDiagnostics);

  $('#set-models-load').addEventListener('click', loadModelList);
  $('#set-test').addEventListener('click', async () => {
    const out = $('#set-test-out');
    const key = $('#set-key').value.trim();
    if (key !== state.settings.apiKey) { const n = await applyKey(key); if (n) toast(markedMsg(n).trim()); }
    out.className = 'hint';
    out.innerHTML = '<span class="spin"></span>Teste …';
    try {
      await ai.testConnection(state.settings);
      out.className = 'hint ok';
      out.textContent = 'Verbindung steht – die KI antwortet.';
    } catch (e) {
      out.className = 'hint err';
      out.textContent = e.message;
    }
  });

  const mgrHandler = (root) => {
    root.addEventListener('change', (e) => {
      if (e.target.closest('select')) return;
      const inp = e.target.closest('[data-rename]');
      if (!inp) return;
      const m = inp.closest('.m');
      renameNamed(m.dataset.kind, m.dataset.id, inp.value);
    });
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-drop]');
      if (!btn) return;
      const m = btn.closest('.m');
      dropNamed(m.dataset.kind, m.dataset.id);
    });
  };
  mgrHandler($('#cat-mgr'));

  // Unterseiten: Zeile öffnet, „Zurück“ führt erst zur Hauptseite der Einstellungen.
  $('#view-settings').addEventListener('click', (e) => {
    const go = e.target.closest('[data-spage-go]');
    if (go) settingsPage(go.dataset.spageGo);
  });
  $('#view-settings [data-nav="back"]').addEventListener('click', (e) => {
    if (!spage) return;
    e.stopPropagation();
    settingsPage('');
  });
  $('#feedback').href = `mailto:?subject=${encodeURIComponent(`Keepsy ${APP_VERSION} – Feedback`)}`;

  $('#cat-add').addEventListener('click', () => addNamed('categories', $('#cat-new')));
}
