// Aktionsblatt von unten – für das Kontextmenü nach langem Drücken und kleine
// Eingaben (Raum ändern, Umbenennen). Schließt per Tipp daneben, „Abbrechen“,
// Escape oder nach unten ziehen.
import { esc, icon } from './ui.js';
import { reduced } from './motion.js';

const $ = (s) => document.querySelector(s);
let onAction = null;
let onSubmit = null;
let closing = null;

export const isOpen = () => !$('#sheet').hidden && !closing;

function show(html) {
  const wrap = $('#sheet');
  const sheet = wrap.querySelector('.sheet');
  $('#sheet-body').innerHTML = html;
  if (!wrap.hidden && !closing) return;   // schon offen: nur Inhalt tauschen
  closing = null;
  wrap.hidden = false;
  sheet.style.transform = '';
  if (!reduced() && sheet.animate) {
    sheet.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.32,.72,0,1)' });
    wrap.querySelector('.sheet-backdrop').animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
  }
  followKeyboard(true);
}

/** Aktionen: [{ id, label, icon, danger }]. head: fertiges (escaptes) HTML für den Kopf. */
export function open({ head = '', actions, onAction: fn }) {
  onAction = fn;
  onSubmit = null;
  show(`${head ? `<div class="sheet-head">${head}</div>` : ''}
    <div class="sheet-actions">${actions.map(a => `<button class="sheet-act${a.danger ? ' danger' : ''}" data-act="${esc(a.id)}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`).join('')}</div>
    <button class="sheet-cancel" data-sheet-close>Abbrechen</button>`);
  const first = $('#sheet-body .sheet-act');
  if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
}

/** Ein Eingabefeld mit Übernehmen-Knopf. onSubmit(value) darf false liefern, um offen zu bleiben. */
export function form({ head = '', title, label, value = '', placeholder = '', combo = '', submit = 'Übernehmen', onSubmit: fn }) {
  onAction = null;
  onSubmit = fn;
  show(`${head ? `<div class="sheet-head">${head}</div>` : ''}
    <form class="sheet-form" novalidate>
      <h2 class="sheet-title" id="sheet-title">${esc(title)}</h2>
      <label class="field"><span>${esc(label)}</span>
        <input id="sheet-input" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off"${combo ? ` data-combo="${esc(combo)}"` : ''} enterkeyhint="done">
      </label>
      <button class="btn primary block" type="submit">${esc(submit)}</button>
    </form>
    <button class="sheet-cancel" data-sheet-close>Abbrechen</button>`);
  const input = $('#sheet-input');
  // Aus der Vorschlagsliste gewählt: gleich übernehmen, ein weiterer Tipp wäre überflüssig.
  if (combo) {
    input.addEventListener('change', (e) => {
      if (e.isTrusted || !input.value.trim()) return;
      if (input.form.requestSubmit) input.form.requestSubmit();
      else input.form.dispatchEvent(new Event('submit', { cancelable: true }));
    });
  }
  // Muss direkt im Tipp passieren, sonst öffnet iOS die Tastatur nicht.
  try { input.focus({ preventScroll: true }); input.select(); } catch (_) { void _; }
}

export function close() {
  const wrap = $('#sheet');
  if (wrap.hidden || closing) return closing || Promise.resolve();
  const sheet = wrap.querySelector('.sheet');
  const active = document.activeElement;
  if (active && wrap.contains(active)) active.blur();
  followKeyboard(false);
  const done = () => {
    wrap.hidden = true;
    sheet.style.transform = '';
    $('#sheet-body').innerHTML = '';
    onAction = onSubmit = null;
    closing = null;
  };
  if (reduced() || !sheet.animate) { done(); return Promise.resolve(); }
  const from = sheet.style.transform || 'none';
  const o = { duration: 260, easing: 'cubic-bezier(.4,0,.8,.6)', fill: 'forwards' };
  const a = sheet.animate([{ transform: from }, { transform: 'translateY(110%)' }], o);
  const b = wrap.querySelector('.sheet-backdrop').animate([{ opacity: 1 }, { opacity: 0 }], o);
  closing = Promise.all([a.finished, b.finished]).catch(() => null).then(() => { done(); a.cancel(); b.cancel(); });
  return closing;
}

// Bei offener Tastatur das Blatt über ihr halten (iOS verschiebt sonst den Ausschnitt).
let vvHandler = null;
function followKeyboard(on) {
  const vv = window.visualViewport;
  const sheet = $('#sheet .sheet');
  if (!vv) return;
  if (vvHandler) { vv.removeEventListener('resize', vvHandler); vv.removeEventListener('scroll', vvHandler); vvHandler = null; }
  sheet.style.bottom = '';
  if (!on) return;
  vvHandler = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    sheet.style.bottom = kb > 40 ? kb + 'px' : '';
    sheet.classList.toggle('kb', kb > 40);
  };
  vv.addEventListener('resize', vvHandler);
  vv.addEventListener('scroll', vvHandler);
}

export function init() {
  const wrap = $('#sheet');
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) { close(); return; }
    const act = e.target.closest('[data-act]');
    if (act && onAction) {
      const fn = onAction;
      fn(act.dataset.act);   // darf selbst ein Formular öffnen oder schließen
    }
  });
  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = wrap.querySelector('.sheet-form [type="submit"]');
    btn.disabled = true;
    try {
      const keep = await onSubmit($('#sheet-input').value.trim());
      if (keep !== false) close();
    } finally {
      btn.disabled = false;
    }
  });
  // Escape im Eingabefeld schließt nur die Vorschlagsliste, sonst das Blatt.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen() && !e.target.closest?.('#sheet input')) close(); });

  // Nach unten ziehen schließt – am Griff oder im Kopf.
  const sheet = wrap.querySelector('.sheet');
  let s = null;
  sheet.addEventListener('touchstart', (e) => {
    if (!e.target.closest('.sheet-grab, .sheet-head, .sheet-title') || e.touches.length !== 1) return;
    s = { y0: e.touches[0].clientY, t0: e.timeStamp, dy: 0 };
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (!s) return;
    s.dy = Math.max(0, e.touches[0].clientY - s.y0);
    if (s.dy > 0 && e.cancelable) e.preventDefault();
    sheet.style.transform = s.dy ? `translateY(${s.dy}px)` : '';
  }, { passive: false });
  sheet.addEventListener('touchend', (e) => {
    if (!s) return;
    const { dy, t0 } = s;
    s = null;
    const v = dy / Math.max(1, e.timeStamp - t0);
    if (dy > sheet.offsetHeight * 0.25 || (v > 0.6 && dy > 20)) { close(); return; }
    if (dy && sheet.animate && !reduced()) {
      sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    sheet.style.transform = '';
  });
}
