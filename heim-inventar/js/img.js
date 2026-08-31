// Bild-Hilfsfunktionen: dekodieren (mit EXIF-Drehung), verkleinern, kodieren.

// Liefert eine für canvas.drawImage nutzbare Quelle mit korrekter Ausrichtung.
export async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (_) { void _; /* ältere Safari-Versionen: Fallback unten */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.'));
      img.src = url;
    });
    // <img> wendet die EXIF-Drehung beim Rendern selbst an.
    if (img.decode) { try { await img.decode(); } catch (_) { void _; } }
    return img;
  } finally {
    // Erst nach dem nächsten Frame freigeben, damit das Bild sicher dekodiert ist.
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

function dimsOf(src) {
  return {
    w: src.width || src.naturalWidth || 0,
    h: src.height || src.naturalHeight || 0,
  };
}

function scaleTo(src, maxEdge) {
  const { w, h } = dimsOf(src);
  if (!w || !h) throw new Error('Bild hat keine lesbaren Abmessungen.');
  const f = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * f));
  const ch = Math.max(1, Math.round(h * f));
  const c = document.createElement('canvas');
  c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  return c;
}

export function toBlob(src, maxEdge, quality) {
  const c = scaleTo(src, maxEdge);
  return new Promise((resolve, reject) => {
    c.toBlob(b => b ? resolve(b) : reject(new Error('Bild konnte nicht kodiert werden.')), 'image/jpeg', quality);
  });
}

export function toDataURL(src, maxEdge, quality) {
  return scaleTo(src, maxEdge).toDataURL('image/jpeg', quality);
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.onerror = () => reject(fr.error || new Error('Datei konnte nicht gelesen werden.'));
    fr.readAsDataURL(blob);
  });
}

// Aus dem in IndexedDB abgelegten ArrayBuffer wieder eine anzeigbare URL machen.
export function photoURL(photo) {
  if (!photo) return null;
  return URL.createObjectURL(new Blob([photo.buf], { type: photo.type || 'image/jpeg' }));
}
