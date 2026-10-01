// Selten Gebrauchtes erst bei Bedarf laden (1.10.0): Aktenschrank (mit Scan), Sicherung,
// Verschlüsselung, Google Drive und die Einführung kommen per import(), wenn man sie braucht –
// der Service Worker hält sie trotzdem offline bereit.
import * as db from './db.js';
import * as home from './home.js';
import { haptic } from './gestures.js';
import { $ } from './ui.js';
import { navigate, renderCurrent } from './nav.js';
import { onSyncStatus } from './settings-backup.js';
import { placeName, reloadAll, state } from './state.js';
import { toast } from './toast.js';
import { resetCapture } from './view-add.js';
import { openItem, openLightbox, renderDocs } from './view-item.js';
import { applyKey, markedMsg } from './view-settings.js';

/* Was Zuhause beim Start zeigt (Fristen, Anzahl Dokumente, Drive-Status), liest schlank aus
 * docs.js bzw. den Einstellungen. Die Promises werden gemerkt; scheitert ein Laden (offline
 * ohne Cache), versucht der nächste Aufruf es erneut. */
const once = (load) => { let p = null; return () => (p ||= load().catch((e) => { p = null; throw e; })); };
export const backupMod = once(() => import('./backup.js'));
export const cryptoMod = once(() => import('./crypto.js'));
export const isWrongPw = (e) => e?.name === 'WrongPassword';
export let cabM = null;   // geladener Aktenschrank – für synchrone Aufrufe aus Ansichten, die nur er öffnet
export const cabinet = once(() => import('./cabinet.js').then((m) => {
  m.init({
    state, navigate, toast, haptic, openLightbox, openItem,
    itemById: (id) => state.items.find(i => i.id === id) || null,
    items: () => state.items,
    onChange: () => { if (state.view === 'home') home.renderHome(); if (state.view === 'item' && state.currentId) renderDocs(state.currentId); },
  });
  cabM = m;
  return m;
}));
export let onbM = null;
export const onboarding = once(() => import('./onboarding.js').then((m) => {
  m.init({
    places: () => state.places.map(p => ({ name: p.name, icon: p.icon })),
    rooms: () => state.rooms.map(r => ({ name: r.name, place: placeName(r.placeId) })),
    apiKey: () => state.settings.apiKey,
    done: finishOnboarding,
  });
  onbM = m;
  return m;
}));
export let gd = null;     // geladenes Google-Drive-Modul (für synchrone Status-Abfragen und Tipps)
export const gdrive = once(() => import('./gdrive.js').then(async (m) => {
  await m.init({
    settings: () => state.settings,
    setSetting: (k, v) => { state.settings[k] = v; return db.setSetting(k, v); },
    onStatus: onSyncStatus,
  });
  gd = m;
  onSyncStatus();
  return m;
}));
export const gdWanted = () => !!(String(state.settings.gdClientId || '').trim() && state.settings.gdEnabled);
// Solange das Modul nicht geladen ist: Status aus den Einstellungen.
export const gdStatus = () => (gd ? gd.status() : { state: gdWanted() ? 'idle' : 'off', error: '', progress: '', last: Number(state.settings.gdLastSync) || 0, enabled: gdWanted() });
export const gdStatusText = () => (gd ? gd.statusText() : '');

// Den Aktenschrank nach dem Start in einer ruhigen Minute vorladen (1.10.2): Beim Öffnen eines
// PDF-Belegs muss window.open synchron in der Geste bleiben – iOS sperrt das Fenster sonst als Popup.
export function preloadCabinet() {
  const idle = window.requestIdleCallback
    ? (fn) => window.requestIdleCallback(fn, { timeout: 5000 })
    : (fn) => setTimeout(fn, 200);
  setTimeout(() => idle(() => { cabinet().catch(() => {}); }), 2500);
}

// skipped: übersprungen (oder Escape) – dann bleibt man, wo man war (beim ersten Start
// Zuhause, beim erneuten Zeigen die Einstellungen), und der Fokus kehrt zum Auslöser zurück.
async function finishOnboarding({ key, goAdd, skipped }) {
  state.settings.onboarded = true;
  if (key && key !== (state.settings.apiKey || '')) {
    const n = await applyKey(key);
    $('#set-key').value = key;
    if (n) toast(markedMsg(n).trim());
  }
  await reloadAll();
  if (skipped) { renderCurrent(); return; }
  navigate(goAdd ? 'add' : 'home', { instant: true });
  if (goAdd) resetCapture();
}

export function openCabinet(at) {
  cabinet().then((c) => c.open(at)).catch((e) => toast('Dokumente laden: ' + e.message, true));
}

// Ansichten des Aktenschranks: Er öffnet sie selbst und ist dann schon geladen (cabM).
export function wireDocs() {
  // Diese Ansichten öffnet nur der Aktenschrank selbst – er ist dann schon geladen (cabM).
  $('#docs-back').addEventListener('click', () => cabM?.up());
  $('#docs-q').addEventListener('input', () => cabM?.render());
  $('#docs-list').addEventListener('click', (e) => cabM?.onClick(e));
  $('#docs-empty').addEventListener('click', (e) => cabM?.onClick(e));
  $('#docs-list').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-folder-menu]')) { e.preventDefault(); cabM?.onClick(e); } });
  $('#docs-folder-add').addEventListener('click', () => cabM?.newFolder());
  for (const b of [$('#docs-add'), $('#docs-new')]) b.addEventListener('click', () => cabinet().then((c) => c.openAdd()));
  $('#da-scan').addEventListener('click', () => $('#da-scan-input').click());
  $('#da-photos').addEventListener('click', () => $('#da-photos-input').click());
  $('#da-file').addEventListener('click', () => $('#da-file-input').click());
  $('#da-scan-input').addEventListener('change', (e) => { cabM?.addPages(e.target.files || [], true); e.target.value = ''; });
  $('#da-photos-input').addEventListener('change', (e) => { cabM?.addPages(e.target.files || [], false); e.target.value = ''; });
  $('#da-file-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f && /pdf/i.test(f.type || f.name)) cabM?.setFile(f); else if (f) cabM?.addPages([f], false);
    e.target.value = '';
  });
  $('#da-pages-card').addEventListener('click', (e) => cabM?.onAddClick(e));
  $('#da-filecard').addEventListener('click', (e) => cabM?.onAddClick(e));
  $('#da-enhance').addEventListener('change', () => cabM?.renderAdd());
  $('#da-due-kind').addEventListener('change', (e) => { $('#da-due-row').hidden = !e.target.value; });
  $('#da-save').addEventListener('click', () => cabM?.save());
}
