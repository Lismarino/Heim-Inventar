// Sicherung: Datei erstellen (optional verschlüsselt), teilen, einlesen; Erinnerung auf Start;
// Passwort-Blatt; Google-Drive-Sicherung.
import * as db from './db.js';
import * as queue from './queue.js';
import * as home from './home.js';
import * as sheet from './sheet.js';
import * as sound from './sound.js';
import { $, dtf, esc, icon, plural } from './ui.js';
import { backupMod, cryptoMod, gd, gdrive, gdStatus, gdStatusText, isWrongPw } from './lazy.js';
import { navigate, renderCurrent } from './nav.js';
import { reloadAll, state } from './state.js';
import { toast } from './toast.js';
import { renderList } from './view-list.js';
import { renderManagers, renderSettingsStatus, updateStorageInfo } from './view-settings.js';

let exportFile = null;   // { blob, filename, counts }
let importData = null;

const mb = (bytes) => (bytes / 1048576).toFixed(bytes < 1048576 ? 2 : 1) + ' MB';

// Mit Haken „verschlüsseln“: erst das Passwort (zweimal), dann erstellen.
function buildBackupClick() {
  if (!$('#exp-encrypt').checked) { buildBackup(); return; }
  passwordSheet({
    title: 'Sicherungsdatei verschlüsseln', repeat: true, remember: false, submit: 'Verschlüsseln & erstellen',
    note: 'Ohne dieses Passwort lässt sich die Datei nie wieder öffnen – auch nicht von uns. Gut aufbewahren!',
    onPassword: (pw) => { buildBackup(pw); },
  });
}

async function buildBackup(password = '') {
  const out = $('#exp-out');
  const btn = $('#exp-build');
  $('#exp-save').hidden = true;
  exportFile = null;
  btn.disabled = true;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Sicherung wird erstellt …';
  try {
    const withPhotos = $('#exp-photos').checked;
    const backup = await backupMod();
    exportFile = await backup.buildExport({
      withPhotos,
      onProgress: (i, n) => { out.innerHTML = `<span class="spin"></span>Foto ${i} von ${n} …`; },
    });
    if (password) {
      out.innerHTML = '<span class="spin"></span>Wird verschlüsselt …';
      exportFile.blob = await (await cryptoMod()).sealBackup(exportFile.blob, password);
      exportFile.filename = exportFile.filename.replace(/\.json$/, '-verschluesselt.json');
    }
    const c = exportFile.counts;
    out.className = 'hint ok';
    out.textContent = `Fertig: ${plural(c.items, 'Ding', 'Dinge')}${c.archived ? ` (davon ${c.archived} im Papierkorb)` : ''}, ${c.photos} Fotos, `
      + `${c.categories} Kategorien, ${plural(c.places, 'Ort', 'Orte')}, ${c.rooms} Räume, ${plural(c.docs || 0, 'Dokument', 'Dokumente')} – ${mb(exportFile.blob.size)}`
      + (password ? ', verschlüsselt.' : '.');
    $('#exp-save').hidden = false;
    sound.play('bell');
  } catch (e) {
    out.className = 'hint err';
    out.textContent = 'Sicherung fehlgeschlagen: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// Muss direkt aus dem Tippen heraus laufen, sonst blockiert iOS das Teilen-Fenster.
async function saveBackup() {
  if (!exportFile) return;
  const { blob, filename } = exportFile;
  const file = new File([blob], filename, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Heim-Inventar Sicherung' });
      markBackedUp();
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;   // Nutzer hat abgebrochen
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  markBackedUp();
}

// Sicherung ist raus: Zeitpunkt merken – die Erinnerung auf Zuhause ruht dann wieder.
async function markBackedUp() {
  state.settings.lastBackupAt = Date.now();
  state.homeBackup = '';
  if (state.view === 'home') home.renderHome();
  renderSettingsStatus();
  try { await db.setSetting('lastBackupAt', state.settings.lastBackupAt); } catch (e) { console.warn('Sicherungszeit merken:', e); }
}

// Zuhause: 1. Tipp erstellt die Sicherung. Ist die Geste danach noch frisch (Safari lässt
// das Teilen-Fenster nur direkt aus einem Tipp zu), öffnet es gleich – sonst steht „Teilen“ da.
export async function homeBackupGo() {
  if (state.homeBackup === 'building') return;
  if (state.homeBackup === 'ready' && exportFile) { await saveBackup(); return; }
  // Verschlüsselt gewünscht: das Passwort gehört in die Einstellungen, nicht auf Zuhause.
  if (state.settings.expEncrypt) { navigate('settings'); $('#exp-build').scrollIntoView({ block: 'center' }); buildBackupClick(); return; }
  state.homeBackup = 'building';
  home.renderHome();
  try {
    exportFile = await (await backupMod()).buildExport({ withPhotos: true });
    state.homeBackup = 'ready';
    sound.play('bell');
  } catch (e) {
    state.homeBackup = '';
    toast('Sicherung fehlgeschlagen: ' + e.message, true);
  }
  if (state.view === 'home') home.renderHome();
  if (state.homeBackup === 'ready' && navigator.userActivation?.isActive && navigator.canShare) await saveBackup();
}

export async function snoozeBackup() {
  const until = Date.now() + 3 * 86400000;
  state.settings.backupSnooze = until;
  state.homeBackup = '';
  home.renderHome();
  try { await db.setSetting('backupSnooze', until); } catch (e) { console.warn('Später merken:', e); }
}

async function readImportFile(file) {
  const out = $('#imp-out');
  $('#imp-choice').hidden = true;
  importData = null;
  if (!file) return;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Datei wird gelesen …';
  try {
    let text;
    try {
      text = await file.text();
    } catch (e) {
      throw new Error('Die Datei konnte nicht gelesen werden: ' + e.message);
    }
    const backup = await backupMod();
    importData = backup.parseBackup(text);
    const cr = await cryptoMod();
    if (cr.isEncryptedBackup(importData)) {
      const wrap = importData;
      importData = null;
      out.textContent = 'Die Sicherung ist verschlüsselt.';
      passwordSheet({
        title: 'Sicherung entschlüsseln', repeat: false, remember: false, submit: 'Öffnen',
        onPassword: async (pw) => {
          out.innerHTML = '<span class="spin"></span>Wird entschlüsselt …';
          try {
            importData = backup.parseBackup(await cr.openBackup(wrap, pw));
            showImportInfo();
          } catch (e) {
            importData = null;
            $('#imp-input').value = '';
            out.className = 'hint err';
            out.textContent = isWrongPw(e) ? 'Das Passwort stimmt nicht. Es wurde nichts verändert.' : e.message;
          }
        },
      });
      return;
    }
    showImportInfo();
  } catch (e) {
    importData = null;
    $('#imp-input').value = '';
    out.className = 'hint err';
    out.textContent = e.message;
  }
}

function showImportInfo() {
  const out = $('#imp-out');
  const c = importData.counts || {};
  const when = importData.exportedAt ? dtf.format(new Date(importData.exportedAt)) : 'unbekannt';
  out.className = 'hint';
  const places = Array.isArray(importData.places) ? importData.places.length : 0;
  const arch = (importData.items || []).filter(it => it && it.archived).length;
  out.textContent = `Sicherung vom ${when}: ${plural(c.items ?? importData.items.length, 'Ding', 'Dinge')}${arch ? ` (davon ${arch} im Papierkorb)` : ''}, `
    + `${(importData.photos || []).length} Fotos, ${(importData.categories || []).length} Kategorien, `
    + (places ? `${plural(places, 'Ort', 'Orte')}, ` : '')
    + `${(importData.rooms || []).length} Räume`
    + (!places && (importData.rooms || []).length ? ' (aus der Zeit vor den Orten – sie kommen nach „Zuhause“)' : '')
    + (Array.isArray(importData.docs) && importData.docs.length ? `, ${plural(importData.docs.length, 'Dokument', 'Dokumente')}` : '')
    + '. Wie soll eingelesen werden?';
  $('#imp-choice').hidden = false;
}

async function runImport(mode) {
  if (!importData) return;
  if (mode === 'replace' && !confirm('Wirklich alles ersetzen? Die aktuellen Dinge und Fotos auf diesem Gerät werden vorher gelöscht.')) return;

  const out = $('#imp-out');
  $('#imp-choice').hidden = true;
  out.className = 'hint';
  out.innerHTML = '<span class="spin"></span>Wird eingelesen …';
  try {
    const stats = await (await backupMod()).applyBackup(importData, mode, (i, n) => {
      out.innerHTML = `<span class="spin"></span>Foto ${i} von ${n} …`;
    });
    importData = null;
    $('#imp-input').value = '';
    await reloadAll();
    renderManagers();
    renderList();
    updateStorageInfo();
    queue.kick();   // mitgebrachte, noch nicht erkannte Fotos jetzt abarbeiten
    out.className = 'hint ok';
    sound.play('bell');
    out.textContent = `${plural(stats.items, 'Ding', 'Dinge')}, ${stats.photos} Fotos und ${plural(stats.docs || 0, 'Dokument', 'Dokumente')} eingelesen`
      + (stats.skipped ? `, ${stats.skipped} waren schon vorhanden.` : '.');
  } catch (e) {
    out.className = 'hint err';
    // Geschrieben wird in einer einzigen Transaktion – der alte Stand ist unverändert.
    out.textContent = 'Import fehlgeschlagen: ' + e.message + ' Es wurde nichts verändert.';
  }
}

/**
 * Passwort-Blatt. repeat: zweimal eingeben (beim Festlegen); remember: Haken „auf diesem Gerät
 * merken“. onPassword(pw, remember) läuft DIREKT im Tipp auf „Übernehmen“ an – wichtig für
 * das Google-Anmeldefenster auf dem iPhone.
 */
function passwordSheet({ title, repeat = false, remember = false, submit = 'Weiter', note = '', onPassword }) {
  const html = `${note ? `<p class="hint lead warn">${esc(note)}</p>` : ''}
    <label class="field"><span>Passwort</span><input id="sheet-pw1" type="password" autocomplete="${repeat ? 'new-password' : 'current-password'}" autocapitalize="off" spellcheck="false"></label>
    ${repeat ? '<label class="field"><span>Wiederholen</span><input id="sheet-pw2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>' : ''}
    ${remember ? '<label class="check"><input type="checkbox" id="sheet-remember" checked> <span>Auf diesem Gerät merken <small>(nur als nicht auslesbarer Schlüssel)</small></span></label>' : ''}
    <p class="hint err" id="sheet-pw-err"></p>`;
  sheet.panel({
    head: `<span class="sh-pic ph ph-none">${icon('lock')}</span><span class="sh-txt"><b>${esc(title)}</b></span>`,
    title, html, submit, focus: '#sheet-pw1',
    onSubmit: (_v, form) => {
      const pw = form.querySelector('#sheet-pw1').value;
      const err = form.querySelector('#sheet-pw-err');
      if (repeat && pw.length < 8) { err.textContent = 'Bitte mindestens 8 Zeichen.'; return false; }
      if (!pw) { err.textContent = 'Bitte das Passwort eingeben.'; return false; }
      if (repeat && pw !== form.querySelector('#sheet-pw2').value) { err.textContent = 'Die beiden Eingaben stimmen nicht überein.'; return false; }
      onPassword(pw, !!form.querySelector('#sheet-remember')?.checked);
    },
  });
}

function gdOut(text, cls = '') {
  const out = $('#gd-out');
  out.className = 'hint' + (cls ? ' ' + cls : '');
  if (cls === 'busy') out.innerHTML = `<span class="spin"></span>${esc(text)}`; else out.textContent = text;
}

function gdSetupClick() {
  const cid = $('#gd-client').value.trim();
  state.settings.gdClientId = cid;
  db.setSetting('gdClientId', cid).catch(() => {});
  if (!cid) { toast('Bitte zuerst die OAuth-Client-ID eintragen (Anleitung darunter).', true); $('#gd-client').focus(); return; }
  gdrive().then((m) => m.loadGsi()).catch(() => {});
  passwordSheet({
    title: 'Passwort für die Google-Sicherung', repeat: true, remember: true, submit: 'Mit Google verbinden',
    note: 'Mit diesem Passwort wird alles verschlüsselt, bevor es das Gerät verlässt. Passwort vergessen = Sicherung unbrauchbar. Gibt es schon eine Sicherung, nimm dasselbe Passwort wie dort.',
    onPassword: (pw, remember) => {
      // Noch im Tipp: Anmeldefenster. Das Modul lädt beim Öffnen der Einstellungen vor (gdPreload).
      const conn = gd ? gd.connect() : gdrive().then((m) => m.connect());
      gdOut('Verbinde mit Google …', 'busy');
      conn.then(() => gd.setup(pw, remember))
        .then((r) => { sound.play('bell'); gdOut(r ? `Eingerichtet und gesichert (${plural(r.uploaded, 'Datei', 'Dateien')} hochgeladen).` : 'Eingerichtet.', 'ok'); toast('Google-Sicherung ist eingerichtet.'); })
        .catch((e) => { gdOut(isWrongPw(e) ? 'Das Passwort passt nicht zur vorhandenen Sicherung in Google Drive. Nichts wurde verändert.' : e.message, 'err'); })
        .finally(renderGdSettings);
    },
  });
}

function gdRestoreClick() {
  const cid = $('#gd-client').value.trim();
  if (!cid) { toast('Bitte zuerst die OAuth-Client-ID eintragen.', true); return; }
  if (cid !== state.settings.gdClientId) { state.settings.gdClientId = cid; db.setSetting('gdClientId', cid).catch(() => {}); }
  if (!confirm('Aus Google Drive wiederherstellen? Alles auf diesem Gerät wird durch die Sicherung ersetzt.')) return;
  gdrive().then((m) => m.loadGsi()).catch(() => {});
  passwordSheet({
    title: 'Wiederherstellen', repeat: false, remember: true, submit: 'Wiederherstellen',
    onPassword: (pw, remember) => {
      const conn = gd ? gd.connect() : gdrive().then((m) => m.connect());
      gdOut('Verbinde mit Google …', 'busy');
      conn.then(() => gd.restore(pw, remember, (t) => gdOut(t, 'busy')))
        .then(async (st) => {
          sound.play('bell');
          await reloadAll();
          renderManagers();
          renderCurrent();
          updateStorageInfo();
          queue.kick();
          gdOut(`Wiederhergestellt: ${plural(st.items, 'Ding', 'Dinge')}, ${st.photos} Fotos, ${plural(st.docs, 'Dokument', 'Dokumente')}`
            + (st.missing ? ` – ${st.missing} Dateien fehlten.` : '.'), 'ok');
        })
        .catch((e) => gdOut((isWrongPw(e) ? 'Das Passwort stimmt nicht.' : e.message) + ' Es wurde nichts verändert.', 'err'))
        .finally(renderGdSettings);
    },
  });
}

// Tipp auf die Statuszeile (Zuhause) oder „Jetzt sichern“: je nach Lage anmelden, Passwort, sichern.
export function onSyncTap(manual = false) {
  const x = gdStatus();
  if (x.enabled && !gd) { gdrive().then(() => onSyncTap(manual)).catch((e) => toast(e.message, true)); return; }
  if (!x.enabled) { navigate('settings'); $('#gd-client').scrollIntoView({ block: 'center' }); return; }
  if (x.state === 'needPassword') {
    passwordSheet({
      title: 'Google-Sicherung fortsetzen', remember: true, submit: 'Fortsetzen',
      onPassword: (pw, remember) => {
        const conn = gd.connect();
        conn.then(() => gd.unlock(pw, remember)).then(() => toast('Gesichert.'))
          .catch((e) => toast(isWrongPw(e) ? 'Das Passwort stimmt nicht.' : e.message, true));
      },
    });
    return;
  }
  if (x.state === 'error' && !manual) { navigate('settings'); $('#gd-status').scrollIntoView({ block: 'center' }); return; }
  // Anmeldung nötig oder abgelaufen: das Fenster muss jetzt, im Tipp, aufgehen.
  const run = x.state === 'needAuth' ? gd.connect().then(() => gd.syncNow()) : gd.syncNow();
  run.then((r) => { if (manual && r) sound.play('bell'); if (manual && r) toast(r.uploaded ? `Gesichert – ${plural(r.uploaded, 'neue Datei', 'neue Dateien')}.` : 'Gesichert – nichts Neues.'); })
    .catch((e) => toast(e.message, true));
}

export function onSyncStatus() {
  home.renderSync();
  renderGdSettings();
}

export function renderGdSettings() {
  const x = gdStatus();
  const el = $('#gd-status');
  if (!el) return;
  el.textContent = x.enabled ? (gdStatusText() || 'Wird geladen …') : (state.settings.gdClientId ? 'Noch nicht eingerichtet.' : 'Aus.');
  el.className = 'gd-status' + (x.state === 'error' || x.state === 'needAuth' || x.state === 'needPassword' ? ' warn' : x.state === 'ok' ? ' ok' : '');
  $('#gd-on').hidden = !x.enabled;
  $('#gd-setup').hidden = x.enabled;
}

export function init() {
  // --- Sicherung ---
  $('#exp-build').addEventListener('click', buildBackupClick);
  $('#exp-encrypt').addEventListener('change', (e) => {
    $('#exp-save').hidden = true; $('#exp-out').textContent = ''; exportFile = null;
    state.settings.expEncrypt = e.target.checked;
    db.setSetting('expEncrypt', e.target.checked).catch(() => {});
  });
  $('#exp-save').addEventListener('click', saveBackup);
  $('#exp-photos').addEventListener('change', () => { $('#exp-save').hidden = true; $('#exp-out').textContent = ''; exportFile = null; });
  $('#imp-pick').addEventListener('click', () => $('#imp-input').click());
  $('#imp-input').addEventListener('change', (e) => readImportFile(e.target.files[0]));
  $('#imp-merge').addEventListener('click', () => runImport('merge'));
  $('#imp-replace').addEventListener('click', () => runImport('replace'));
  $('#imp-cancel').addEventListener('click', () => {
    importData = null;
    $('#imp-input').value = '';
    $('#imp-choice').hidden = true;
    $('#imp-out').textContent = '';
  });

  // --- 1.9.0: Google Drive ---
  $('#gd-client').addEventListener('change', (e) => {
    const v = e.target.value.trim();
    state.settings.gdClientId = v;
    db.setSetting('gdClientId', v).catch(() => {});
    if (v && !/\.apps\.googleusercontent\.com$/.test(v)) toast('Die Client-ID endet normalerweise auf „.apps.googleusercontent.com“.', true);
    if (v) gdrive().then((m) => m.loadGsi()).catch(() => {});
    renderGdSettings();
  });
  $('#gd-setup').addEventListener('click', gdSetupClick);
  $('#gd-sync').addEventListener('click', () => onSyncTap(true));
  $('#gd-restore').addEventListener('click', gdRestoreClick);
  $('#gd-off').addEventListener('click', async () => {
    if (!confirm('Google-Sicherung ausschalten? Die Sicherung in Google Drive bleibt liegen; das gemerkte Passwort wird auf diesem Gerät vergessen.')) return;
    await (await gdrive()).disconnect();
    renderGdSettings();
    toast('Google-Sicherung ist aus.');
  });
}
