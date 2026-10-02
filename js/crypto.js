// Verschlüsselung (1.9.0) für die Google-Drive-Sicherung und die verschlüsselte Sicherungsdatei.
// Passwort → PBKDF2 (SHA-256, 310 000 Runden, zufälliges Salz) → AES-GCM-256 (WebCrypto).
// Der Schlüssel ist NICHT exportierbar: Er kann als CryptoKey in IndexedDB liegen („auf diesem
// Gerät merken“), aber weder die App noch ein Skript kann ihn als Bytes auslesen.
// Jedes verschlüsselte Stück: 12 Byte Zufalls-IV + Chiffretext (inkl. 16 Byte Prüfsumme).

const KDF_ITER = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const toHex = (buf) => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
export const randomName = () => toHex(randomBytes(16));

export function toB64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) {
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256(buf) {
  return toHex(await crypto.subtle.digest('SHA-256', buf));
}

/** Passwort + Salz → nicht exportierbarer AES-GCM-Schlüssel. */
export async function deriveKey(password, salt, iter = KDF_ITER) {
  if (!password) throw new Error('Bitte ein Passwort eingeben.');
  if (!crypto?.subtle) throw new Error('Verschlüsselung wird hier nicht unterstützt (nur über https).');
  const base = await crypto.subtle.importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: Math.max(KDF_ITER, Number(iter) || 0) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/** Bytes → IV + Chiffretext. */
export async function encrypt(key, data) {
  const iv = randomBytes(12);
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv, 0);
  out.set(ct, 12);
  return out;
}

export class WrongPassword extends Error {
  constructor() { super('Das Passwort stimmt nicht (oder die Daten sind beschädigt).'); this.name = 'WrongPassword'; }
}

/** IV + Chiffretext → ArrayBuffer. Falscher Schlüssel oder veränderte Daten: WrongPassword. */
export async function decrypt(key, data) {
  const a = new Uint8Array(data);
  if (a.length < 29) throw new WrongPassword();
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.subarray(0, 12) }, key, a.subarray(12));
  } catch (_) {
    void _;
    throw new WrongPassword();
  }
}
export const decryptText = async (key, data) => dec.decode(await decrypt(key, data));

/* ---------- Verschlüsselte Sicherungsdatei (JSON-Hülle um die normale Sicherung) ---------- */

export const isEncryptedBackup = (o) => !!(o && (o.app === 'heim-inventar' || o.app === 'keepsy') && o.encrypted === true);

/** Blob der normalen Sicherung → verschlüsselte Hülle (Blob, JSON). */
export async function sealBackup(blob, password) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  const ct = await encrypt(key, new Uint8Array(await blob.arrayBuffer()));
  const head = { app: 'heim-inventar', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITER, cipher: 'AES-GCM', salt: toB64(salt) };
  return new Blob([JSON.stringify(head).slice(0, -1), ',"data":"', toB64(ct), '"}'], { type: 'application/json' });
}

/** Hülle + Passwort → Text der normalen Sicherung. */
export async function openBackup(wrap, password) {
  const key = await deriveKey(password, fromB64(wrap.salt), wrap.iter);
  return decryptText(key, fromB64(wrap.data));
}
