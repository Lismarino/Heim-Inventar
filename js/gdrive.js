// Automatische Sicherung in Google Drive (1.9.0) – Ende-zu-Ende verschlüsselt.
//
// Ablage: der App-Datenordner von Drive (Scope drive.appdata). Er ist für die Nutzerin und für
// andere Apps unsichtbar, und die App sieht umgekehrt NICHTS von ihrem übrigen Drive – anders
// als drive.file muss man dort nie etwas wiederfinden oder vor versehentlichem Löschen schützen.
//
// Nichts Unverschlüsseltes verlässt das Gerät, auch keine Dateinamen:
// - „hi-manifest“: 4 Byte „HIM1“ + 16 Byte Salz + AES-GCM(JSON mit Einträgen, Kategorien, Orten,
//   Räumen, Ordnern, Dokument- und Foto-Metadaten, Einstellungen ohne API-Key + Blob-Tabelle
//   { id: { f: Drive-Datei-ID, h: SHA-256 des Klartexts, s: Größe } }).
// - je Foto/Dokument eine Datei unter einem zufälligen Namen: AES-GCM(Bytes).
// Inkrementell: nur Neues hochladen, Manifest ZULETZT schreiben, dann Unbenutztes löschen.
// Bricht es mittendrin ab, gilt das alte Manifest weiter; Reste räumt der nächste Lauf auf.
import * as db from './db.js';
import * as cr from './crypto.js';
import { docMeta } from './docs.js';
import { applyBackup, FORMAT_VERSION } from './backup.js';

export const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GSI_URL = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const MANIFEST = 'hi-manifest';
const MAGIC = [0x48, 0x49, 0x4d, 0x31];   // „HIM1“
const DEBOUNCE = 30000;

let ctx = null;          // { settings(): {...}, setSetting(k, v), onStatus(st) }
let key = null;          // { key: CryptoKey, salt: b64 } – nur im Speicher, außer „merken“
let token = null;        // { value, exp }
let tokenClient = null;
let tokenClientId = '';
let pending = null;      // { resolve, reject, timer } – laufende Token-Anfrage
let gsiLoading = null;
let timer = null;
let running = null;
let again = false;
const st = { state: 'off', error: '', progress: '' };

const s = () => ctx?.settings() || {};
export const clientId = () => String(s().gdClientId || '').trim();
export const enabled = () => !!(clientId() && s().gdEnabled);
export const status = () => ({ ...st, last: Number(s().gdLastSync) || 0, enabled: enabled() });

function set(state, error = '', progress = '') {
  st.state = state; st.error = error; st.progress = progress;
  try { ctx?.onStatus?.(status()); } catch (_) { void _; }
}

export async function init(c) {
  ctx = c;
  db.onWrite(() => { if (enabled()) schedule(); });
  window.addEventListener('online', () => { if (enabled()) schedule(1500); });
  if (!enabled()) { set('off'); return; }
  set('idle');
  try {
    const k = await db.get('sync', 'key');
    if (k?.value?.key) key = { key: k.value.key, salt: k.value.salt };
    const t = await db.get('sync', 'token');
    if (t?.value?.exp > Date.now() + 60000) token = t.value;
  } catch (e) { console.warn('Google-Sicherung laden:', e); }
  loadGsi().catch(() => {});   // vorab laden: das Anmelde-Fenster muss später direkt im Tipp aufgehen
  schedule(4000);              // beim App-Start
}

/* ---------------- Google Identity Services ---------------- */

export function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google.accounts.oauth2);
  if (gsiLoading) return gsiLoading;
  gsiLoading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GSI_URL;
    el.async = true;
    el.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new Error('Google-Anmeldung nicht verfügbar.')));
    el.onerror = () => { gsiLoading = null; el.remove(); reject(new Error('Google-Anmeldung konnte nicht geladen werden (offline?).')); };
    document.head.appendChild(el);
  });
  return gsiLoading;
}

function client(oauth2) {
  if (tokenClient && tokenClientId === clientId()) return tokenClient;
  tokenClientId = clientId();
  tokenClient = oauth2.initTokenClient({
    client_id: tokenClientId,
    scope: SCOPE,
    callback: (r) => {
      const p = pending; pending = null;
      if (!p) return;
      clearTimeout(p.timer);
      if (r?.access_token) {
        token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 };
        db.put('sync', { key: 'token', value: token }).catch(() => {});
        p.resolve(token.value);
      } else p.reject(new Error(r?.error_description || r?.error || 'Keine Freigabe von Google.'));
    },
    error_callback: (e) => {
      const p = pending; pending = null;
      if (!p) return;
      clearTimeout(p.timer);
      p.reject(Object.assign(new Error(e?.type === 'popup_closed' ? 'Anmeldung abgebrochen.' : 'Google-Anmeldung nicht möglich.'), { auth: true }));
    },
  });
  return tokenClient;
}

function request(oauth2, prompt) {
  if (pending) { clearTimeout(pending.timer); pending.reject(Object.assign(new Error('Anmeldung ersetzt.'), { auth: true })); }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject, timer: setTimeout(() => { if (pending) { pending = null; reject(Object.assign(new Error('Anmeldung dauert zu lange.'), { auth: true })); } }, 90000) };
    try { client(oauth2).requestAccessToken({ prompt }); } catch (e) { pending = null; reject(Object.assign(e, { auth: true })); }
  });
}

/**
 * Anmelden – MUSS direkt aus einem Tipp heraus aufgerufen werden (iOS öffnet Pop-ups nur dann).
 * Ist das Skript schon geladen, geht das Fenster ohne jedes await vorher auf.
 */
export function connect() {
  if (!clientId()) return Promise.reject(new Error('Bitte zuerst die OAuth-Client-ID eintragen.'));
  const o = window.google?.accounts?.oauth2;
  // prompt '': Zustimmung nur, wenn sie noch fehlt – sonst kein Klick zu viel.
  if (o) return request(o, '');
  return loadGsi().then((o2) => request(o2, ''));
}

// Gültiges Token – still erneuern (prompt ''), scheitert das: Hinweis statt Pop-up-Flut.
async function getToken() {
  if (token && token.exp > Date.now() + 60000) return token.value;
  token = null;
  const o = await loadGsi();
  try {
    return await request(o, '');
  } catch (e) {
    throw Object.assign(new Error('Google-Sicherung: einmal tippen zum Fortsetzen.'), { auth: true, cause: e });
  }
}

/* ---------------- Drive-REST ---------------- */

async function api(url, opts = {}, retry = true) {
  const t = await getToken();
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  if (res.status === 401 && retry) { token = null; await db.del('sync', 'token').catch(() => {}); return api(url, opts, false); }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch (_) { void _; }
    throw new Error(`Google Drive meldet Fehler ${res.status}${msg ? ': ' + msg : ''}.`);
  }
  return res;
}

async function listFiles() {
  const out = [];
  let page = '';
  do {
    const q = `${API}?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size)${page ? '&pageToken=' + encodeURIComponent(page) : ''}`;
    const j = await (await api(q)).json();
    out.push(...(j.files || []));
    page = j.nextPageToken || '';
  } while (page);
  return out;
}

async function upload(name, bytes, fileId) {
  if (fileId) {
    const r = await api(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media&fields=id`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    return (await r.json()).id;
  }
  const boundary = 'hi' + cr.randomName();
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    bytes, `\r\n--${boundary}--`,
  ]);
  const r = await api(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  return (await r.json()).id;
}

const download = async (fileId) => new Uint8Array(await (await api(`${API}/${encodeURIComponent(fileId)}?alt=media`)).arrayBuffer());
const remove = (fileId) => api(`${API}/${encodeURIComponent(fileId)}`, { method: 'DELETE' }).catch((e) => console.warn('Aufräumen:', e.message));

/* ---------------- Manifest ---------------- */

function packManifest(salt, ct) {
  const out = new Uint8Array(4 + 16 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 4); out.set(ct, 20);
  return out;
}
function unpackManifest(bytes) {
  if (bytes.length < 21 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error('Die Sicherung in Google Drive ist unbekannt oder beschädigt.');
  return { salt: bytes.slice(4, 20), ct: bytes.subarray(20) };
}
async function readManifest(fileId, k) {
  const { salt, ct } = unpackManifest(await download(fileId));
  if (cr.toB64(salt) !== k.salt) throw new cr.WrongPassword();
  return JSON.parse(await cr.decryptText(k.key, ct));
}

// Stand der Datenbank ohne Dateien – was ins Manifest kommt. Kein API-Key, keine Client-ID.
async function snapshot() {
  const [items, categories, rooms, places, folders, docs, photoKeys, settings] = await Promise.all([
    db.getAll('items'), db.getAll('categories'), db.getAll('rooms'), db.getAll('places'), db.getAll('folders'),
    db.docMetas(), db.getAllKeys('photos'), db.loadSettings(),
  ]);
  // Nur Fotos, auf die ein Eintrag zeigt – verwaiste Reste nicht hochladen.
  const used = new Set(items.map(i => i.photoId).filter(Boolean));
  const photoIds = photoKeys.filter(id => used.has(id));
  return {
    data: {
      app: 'heim-inventar', version: FORMAT_VERSION, exportedAt: new Date().toISOString(),
      settings: { model: settings.model, imgMax: settings.imgMax },
      places, categories, rooms, folders, items,
      docs: docs.map(docMeta),
    },
    blobs: [...photoIds.map(id => ({ id, store: 'photos' })), ...docs.map(d => ({ id: d.id, store: 'docs', size: d.size }))],
  };
}

// Schutz vor dem gefährlichsten Fehler: ein leeres (neues) Gerät würde die vorhandene Sicherung
// durch „nichts“ ersetzen. Dann lieber anhalten und zum Wiederherstellen raten.
async function guardEmpty(m) {
  const remote = Array.isArray(m?.items) ? m.items.length : 0;
  if (remote && !(await db.getAllKeys('items')).length) {
    throw new Error(`In Google Drive liegt schon eine Sicherung mit ${remote} ${remote === 1 ? 'Eintrag' : 'Einträgen'}, dieses Gerät ist leer. Nutze „Aus Google Drive wiederherstellen“ – sonst würde sie überschrieben.`);
  }
}

/* ---------------- Schlüssel ---------------- */

export const hasKey = () => !!key;

async function keepKey(k, remember) {
  key = k;
  if (remember) await db.put('sync', { key: 'key', value: { key: k.key, salt: k.salt } });
  else await db.del('sync', 'key').catch(() => {});
}

/**
 * Einrichten (nach connect()): Passwort gegen eine vorhandene Sicherung prüfen oder neu anlegen.
 * Falsches Passwort zu einer vorhandenen Sicherung: WrongPassword – es wird nichts überschrieben.
 */
export async function setup(password, remember) {
  set('syncing', '', 'Verbinde …');
  try {
    const files = await listFiles();
    const man = files.find(f => f.name === MANIFEST);
    let k;
    if (man) {
      const { salt, ct } = unpackManifest(await download(man.id));
      k = { key: await cr.deriveKey(password, salt), salt: cr.toB64(salt) };
      const m = JSON.parse(await cr.decryptText(k.key, ct));   // wirft bei falschem Passwort
      await guardEmpty(m);
      await db.put('sync', { key: 'remote', value: { manifestId: man.id, salt: k.salt, blobs: m.blobs || {} } });
    } else {
      const salt = cr.randomBytes(16);
      k = { key: await cr.deriveKey(password, salt), salt: cr.toB64(salt) };
      await db.del('sync', 'remote').catch(() => {});
    }
    await keepKey(k, remember);
    await ctx.setSetting('gdEnabled', true);
    await ctx.setSetting('gdError', '');
    set('idle');
  } catch (e) {
    set('error', e.message);
    throw e;
  }
  return syncNow();
}

/** Passwort nachreichen (Schlüssel nicht gemerkt) – prüft es gegen das Manifest. */
export async function unlock(password, remember) {
  const files = await listFiles();
  const man = files.find(f => f.name === MANIFEST);
  if (!man) throw new Error('In Google Drive liegt noch keine Sicherung.');
  const { salt, ct } = unpackManifest(await download(man.id));
  const k = { key: await cr.deriveKey(password, salt), salt: cr.toB64(salt) };
  await cr.decrypt(k.key, ct);
  await keepKey(k, remember);
  return syncNow();
}

export async function disconnect() {
  clearTimeout(timer);
  const t = token?.value;
  key = null; token = null;
  try { if (t) window.google?.accounts?.oauth2?.revoke?.(t, () => {}); } catch (_) { void _; }
  for (const k of ['key', 'token', 'remote']) await db.del('sync', k).catch(() => {});
  await ctx.setSetting('gdEnabled', false);
  set('off');
}

/* ---------------- Sichern ---------------- */

export function schedule(ms = DEBOUNCE) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

/** Eine Sicherungsrunde. Läuft schon eine, folgt direkt danach eine weitere. */
export function syncNow() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      return await runSync();
    } finally {
      running = null;
      if (again) { again = false; schedule(2000); }
    }
  })();
  return running;
}

async function runSync() {
  if (!enabled()) { set('off'); return null; }
  if (!navigator.onLine) { set('idle', '', 'Offline – wird nachgeholt'); return null; }
  if (!key) { set('needPassword', 'Passwort für die Google-Sicherung eingeben.'); return null; }
  set('syncing', '', 'Wird gesichert …');
  try {
    await getToken();
  } catch (e) {
    set('needAuth', e.message);
    return null;
  }
  try {
    const files = await listFiles();
    const exists = new Set(files.map(f => f.id));
    const man = files.find(f => f.name === MANIFEST);
    let remote = (await db.get('sync', 'remote'))?.value || null;
    if (man && (!remote || remote.manifestId !== man.id || remote.salt !== key.salt)) {
      // Kein (passender) lokaler Stand: die Tabelle aus dem Manifest selbst lesen.
      const m = await readManifest(man.id, key);
      await guardEmpty(m);
      remote = { manifestId: man.id, salt: key.salt, blobs: m.blobs || {} };
    }
    const table = remote?.blobs || {};
    const snap = await snapshot();
    const next = {};
    let up = 0;
    for (let i = 0; i < snap.blobs.length; i++) {
      const b = snap.blobs[i];
      const prev = table[b.id];
      if (prev && exists.has(prev.f) && (b.size == null || prev.s === b.size)) { next[b.id] = prev; continue; }
      const rec = await db.get(b.store, b.id);
      if (!rec?.buf) continue;
      set('syncing', '', `Lade hoch … ${i + 1}/${snap.blobs.length}`);
      const h = await cr.sha256(rec.buf);
      const f = await upload(cr.randomName(), await cr.encrypt(key.key, new Uint8Array(rec.buf)));
      next[b.id] = { f, h, s: rec.buf.byteLength };
      up++;
    }
    // Manifest zuletzt – erst jetzt zeigt die Sicherung auf die neuen Dateien.
    const body = JSON.stringify({ ...snap.data, blobs: next });
    const manId = await upload(MANIFEST, packManifest(cr.fromB64(key.salt), await cr.encrypt(key.key, body)), man?.id);
    await db.put('sync', { key: 'remote', value: { manifestId: manId, salt: key.salt, blobs: next } });
    // Aufräumen: alles, worauf das neue Manifest nicht zeigt (Gelöschtes, Reste abgebrochener Läufe).
    const keep = new Set([manId, ...Object.values(next).map(x => x.f)]);
    let gone = 0;
    for (const f of files) if (!keep.has(f.id)) { await remove(f.id); gone++; }
    await ctx.setSetting('gdLastSync', Date.now());
    await ctx.setSetting('gdError', '');
    set('ok');
    return { uploaded: up, deleted: gone, blobs: Object.keys(next).length };
  } catch (e) {
    const msg = e instanceof cr.WrongPassword
      ? 'Die Sicherung in Google Drive gehört zu einem anderen Passwort. Nichts wurde überschrieben.'
      : e.message;
    if (e instanceof cr.WrongPassword) { key = null; await db.del('sync', 'key').catch(() => {}); }
    await ctx.setSetting('gdError', msg).catch(() => {});
    set(e.auth ? 'needAuth' : 'error', msg);
    throw new Error(msg);
  }
}

/* ---------------- Wiederherstellen ---------------- */

/**
 * Alles aus Google Drive laden und den Bestand ERSETZEN (atomar wie „Alles ersetzen“ beim
 * Import). Vorher: connect() aus dem Tipp heraus. onProgress(text).
 */
export async function restore(password, remember, onProgress = () => {}) {
  onProgress('Suche Sicherung …');
  const files = await listFiles();
  const man = files.find(f => f.name === MANIFEST);
  if (!man) throw new Error('In Google Drive liegt keine Sicherung dieser App.');
  const { salt, ct } = unpackManifest(await download(man.id));
  onProgress('Entschlüssele …');
  const k = { key: await cr.deriveKey(password, salt), salt: cr.toB64(salt) };
  const m = JSON.parse(await cr.decryptText(k.key, ct));   // falsches Passwort: WrongPassword
  const blobs = m.blobs || {};
  const photoIds = [...new Set((m.items || []).map(i => i.photoId).filter(id => typeof id === 'string' && blobs[id]))];
  const docs = Array.isArray(m.docs) ? m.docs.filter(d => blobs[d?.id]) : [];
  const total = photoIds.length + docs.length;
  let n = 0, missing = 0;
  const fetchOne = async (id) => {
    n++;
    onProgress(`Lade ${n} von ${total} …`);
    try {
      const buf = await cr.decrypt(k.key, await download(blobs[id].f));
      if (blobs[id].h && (await cr.sha256(buf)) !== blobs[id].h) throw new Error('Prüfsumme');
      return buf;
    } catch (e) {
      if (e instanceof cr.WrongPassword || /Prüfsumme|404/.test(e.message)) { missing++; return null; }
      throw e;
    }
  };
  const photos = [];
  for (const id of photoIds) { const buf = await fetchOne(id); if (buf) photos.push({ id, buf, type: 'image/jpeg', createdAt: Date.now() }); }
  const docsIn = [];
  for (const d of docs) { const buf = await fetchOne(d.id); if (buf) docsIn.push({ ...d, buf }); }
  onProgress('Schreibe in die Datenbank …');
  const stats = await applyBackup({ ...m, app: 'heim-inventar', photos, docs: docsIn }, 'replace');
  await keepKey(k, remember);
  await db.put('sync', { key: 'remote', value: { manifestId: man.id, salt: k.salt, blobs } });
  await ctx.setSetting('gdEnabled', true);
  await ctx.setSetting('gdLastSync', Date.now());
  set('ok');
  return { ...stats, missing };
}

/** „vor 2 Min.“ für die Statuszeile. */
export function ago(t, now = Date.now()) {
  const m = Math.round((now - t) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.round(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.round(h / 24);
  return `vor ${d} ${d === 1 ? 'Tag' : 'Tagen'}`;
}

/** Statuszeile als Text (für Zuhause und Einstellungen). */
export function statusText() {
  const x = status();
  if (!x.enabled) return '';
  if (x.state === 'syncing') return x.progress || 'Wird gesichert …';
  if (x.state === 'needAuth') return 'Google-Sicherung: einmal tippen zum Fortsetzen';
  if (x.state === 'needPassword') return 'Google-Sicherung: Passwort eingeben zum Fortsetzen';
  if (x.state === 'error') return 'Google-Sicherung fehlgeschlagen: ' + x.error;
  if (x.last) return `In Google Drive gesichert ${ago(x.last)}`;
  return x.progress || 'Google-Sicherung eingerichtet – noch nicht gelaufen';
}
