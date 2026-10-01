// Kurze Meldungen (Toast, optional mit Aktion wie „Rückgängig“), Service Worker und Update-Leiste.
import * as motion from './motion.js';
import * as sound from './sound.js';
import { $, esc, icon } from './ui.js';

let toastTimer = null;
export let toastAction = null;   // Aktion des gerade stehenden Toasts (oder null)
// action: { label, run, icon? } – z. B. „Rückgängig“ (Symbol undo); bleibt dann 5 s stehen.
export function toast(msg, isError, action) {
  const t = $('#toast');
  if (isError) sound.play('error');
  toastAction = action || null;
  t.className = 'toast' + (isError ? ' err' : '') + (action ? ' has-act' : '');
  if (action) {
    t.innerHTML = `<span class="toast-msg">${esc(msg)}</span><button class="toast-act" type="button">${icon(action.icon || 'undo')}${esc(action.label)}</button>`;
    t.querySelector('.toast-act').addEventListener('click', () => {
      clearTimeout(toastTimer);
      t.hidden = true;
      toastAction = null;
      action.run();
    }, { once: true });
  } else {
    t.textContent = msg;
  }
  t.hidden = false;
  // Neu einblenden, auch wenn schon ein Toast stand.
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toastTimer);
  // Das Ausblenden (150 ms) zählt zur Standzeit – der Toast ist zur selben Zeit weg wie früher.
  toastTimer = setTimeout(() => hideToast(), (action ? 5000 : isError ? 5200 : 2600) - 150);
}

// Die Glas-Kapsel zieht sich zusammen und verblasst (bei „Bewegung reduzieren“ ohne Animation).
export function hideToast() {
  const t = $('#toast');
  toastAction = null;
  if (t.hidden) return;
  if (!motion.reduced()) t.className += ' out';
  toastTimer = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, 150);
}

// Mischstand nach einem Update beheben: den neuen Service Worker übernehmen lassen und
// einmal neu laden. Die eigentliche Rettung steht inline in index.html (sie muss auch
// laufen, wenn app.js veraltet ist). Stammt index.html noch aus einer Fassung ohne sie,
// hier eine knappe Nachbildung. Liefert true, wenn gleich neu geladen wird.
export async function rescueUpdate(why) {
  if (window.__inventarRescue) return window.__inventarRescue(why);
  if (!('serviceWorker' in navigator)) return false;
  const KEY = 'inventar-rettung';
  try {
    if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 120000) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    await reg.update().catch(() => null);
    let w = reg.waiting;
    const nw = reg.installing;
    if (!w && nw) {
      await new Promise((res) => {
        const t = setTimeout(res, 30000);
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' || nw.state === 'redundant') { clearTimeout(t); res(); } });
      });
      w = reg.waiting;
    }
    if (!w) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
    let done = false;
    const reload = () => { if (!done) { done = true; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', reload);
    w.postMessage({ type: 'SKIP_WAITING' });
    setTimeout(reload, 6000);
    return true;
  } catch (e) {
    console.warn('Update-Rettung fehlgeschlagen:', e);
    return false;
  }
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // Wartet schon eine neue Fassung (z. B. vom letzten Start), gleich anbieten.
    if (reg.waiting) $('#update-bar').hidden = false;

    let reloading = false;
    const reloadOnce = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    $('#update-go').addEventListener('click', () => {
      const w = reg.waiting;
      if (!w) { reloadOnce(); return; }
      $('#update-go').disabled = true;
      // Erst neu laden, wenn der neue Service Worker wirklich übernommen hat.
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
      w.postMessage({ type: 'SKIP_WAITING' });
      setTimeout(reloadOnce, 4000);   // Rückfall, falls das Ereignis ausbleibt
    });
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) $('#update-bar').hidden = false;
      });
    });
  } catch (e) {
    console.warn('Service Worker nicht registriert:', e);
  }
}
