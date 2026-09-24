// Gesten wie in einer iOS-App: langes Drücken, Zeile wegwischen, vom Rand zurückwischen –
// dazu ein haptisches Tick. Alles über Touch-Events, damit vertikales Scrollen
// unangetastet bleibt, solange die Geste nicht eindeutig waagerecht ist. Kein Listener
// hängt blockierend (passive: false) am ganzen Dokument – das bremst sonst jedes Scrollen.

const LONG_MS = 450;     // so lange drücken für das Kontextmenü
const SLOP = 10;         // so viel darf der Finger dabei wandern
const ACTION_W = 96;     // Breite der Aktion hinter einer Zeile

/* ---------------- Haptik ---------------- */

// Neuere iOS-Fassungen geben ein haptisches Tick, wenn ein <input type="checkbox" switch>
// über sein <label> umgeschaltet wird – sofern iOS das auch per Skript zulässt, was nicht
// dokumentiert ist. Android: navigator.vibrate. Scheitert still.
// Verlässlich ist das Tick nur direkt in einer Nutzeraktion; nach einem await oder im
// Timer des langen Drückens ist es ein Bonus. Bewusst kein zweites Tick beim Loslassen:
// greift der Timer, gäbe es sonst zwei.
export function haptic() {
  try {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.head.appendChild(label);
    label.click();
    label.remove();
  } catch (_) { void _; }
  try { navigator.vibrate?.(10); } catch (_) { void _; }
}

/* ---------------- Klick nach einer Geste schlucken ---------------- */

let swallowUntil = 0;
export function suppressClick(ms = 400) { swallowUntil = Date.now() + ms; }
document.addEventListener('click', (e) => {
  // Nur echte Tipps – das Haptik-Label wird per Skript geklickt und muss durch.
  if (e.isTrusted && Date.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); swallowUntil = 0; }
}, true);

const pt = (e) => (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;

/* ---------------- Langes Drücken ---------------- */

// Andere Gesten (Zurückwischen) brechen laufendes langes Drücken ab – sie schlucken
// die Bewegungen, die es sonst selbst abbrechen würden.
const pressCancels = new Set();
const cancelPresses = () => { for (const f of pressCancels) f(); };

/** Ruft onPress(el) nach ~450 ms ruhigem Drücken auf ein Element aus `selector` in `root`. */
export function longPress(root, selector, onPress) {
  let timer = null, el = null, sx = 0, sy = 0, fired = 0;
  const cancel = () => {
    clearTimeout(timer); timer = null;
    if (el) el.classList.remove('pressing');
    el = null;
  };
  pressCancels.add(cancel);
  root.addEventListener('touchstart', (e) => {
    cancel();
    if (e.touches.length !== 1) return;
    const hit = e.target.closest(selector);
    if (!hit || !root.contains(hit) || e.target.closest('input,textarea,select')) return;
    el = hit;
    ({ clientX: sx, clientY: sy } = pt(e));
    el.classList.add('pressing');
    timer = setTimeout(() => {
      const target = el;
      cancel();
      if (!target?.isConnected) return;
      fired = Date.now();
      suppressClick(700);
      haptic();
      onPress(target);
    }, LONG_MS);
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (!timer) return;
    const p = pt(e);
    if (Math.hypot(p.clientX - sx, p.clientY - sy) > SLOP) cancel();
  }, { passive: true });
  root.addEventListener('touchend', (e) => {
    cancel();
    if (Date.now() - fired < 800 && e.cancelable) e.preventDefault();   // kein Klick hinterher
  });
  root.addEventListener('touchcancel', cancel, { passive: true });
  // Rechtsklick am Rechner, langes Drücken unter Android.
  root.addEventListener('contextmenu', (e) => {
    const hit = e.target.closest(selector);
    if (!hit || !root.contains(hit) || e.target.closest('input,textarea')) return;
    e.preventDefault();
    if (Date.now() - fired < 1000) return;   // schon per Touch ausgelöst (nur der Touch-Timer setzt fired)
    cancel();
    onPress(hit);
  });
}

/* ---------------- Zeile nach links wischen ---------------- */

/**
 * Zeilen in `root` (Elemente aus `selector`) lassen sich nach links wischen; dahinter
 * erscheint eine Aktion. Weit genug gewischt oder Aktion angetippt → onAction(row).
 * `actionHTML` ist der Inhalt des Aktionsknopfs.
 */
export function swipeRows(root, selector, actionHTML, onAction) {
  let s = null;          // laufende Geste
  let open = null;       // { row, act } – aufgeklappte Zeile

  const actFor = (row) => {
    const host = row.parentElement;
    let act = host.querySelector(':scope > .swipe-act');
    if (!act) {
      act = document.createElement('button');
      act.className = 'swipe-act';
      act.type = 'button';
      act.innerHTML = actionHTML;
      host.appendChild(act);
    }
    act.style.top = row.offsetTop + 'px';
    act.style.height = row.offsetHeight + 'px';
    act.dataset.for = row.dataset.id || '';
    act.classList.remove('armed');
    act.hidden = false;
    return act;
  };
  const place = (row, act, x) => {
    row.style.transform = x ? `translateX(${x}px)` : '';
    // Der Inhalt der Aktion wandert mit der Kante der Zeile.
    act.style.setProperty('--reveal', Math.min(0, x + ACTION_W) + 'px');
    act.classList.toggle('armed', -x > row.offsetWidth * 0.6);
  };
  const animateTo = (row, act, from, to, done) => {
    const finish = () => { place(row, act, to); row.classList.remove('swiping'); done?.(); };
    if (typeof row.animate !== 'function' || from === to) { finish(); return; }
    row.classList.add('swiping');
    const o = { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' };
    const anim = row.animate([{ transform: `translateX(${from}px)` }, { transform: `translateX(${to}px)` }], o);
    place(row, act, to);
    anim.finished.then(finish, finish);
  };
  const close = (instant) => {
    if (!open) return;
    const { row, act } = open;
    open = null;
    if (!row.isConnected) { act.remove(); return; }
    if (instant) { place(row, act, 0); act.hidden = true; return; }
    animateTo(row, act, -ACTION_W, 0, () => { if (!open || open.act !== act) act.hidden = true; });
  };
  const fire = (row, act, from) => {
    open = null;
    suppressClick();
    haptic();
    const w = row.offsetWidth;
    animateTo(row, act, from, -w, () => onAction(row));
  };

  root.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    // Die Liste wurde inzwischen neu gezeichnet: die gemerkte Zeile gibt es nicht mehr.
    if (open && !open.row.isConnected) { open.act.remove(); open = null; }
    const row = e.target.closest(selector);
    if (e.target.closest('.swipe-act')) return;
    // Ist eine andere Zeile aufgeklappt, schließt der Tipp nur diese – wie in iOS.
    if (open && open.row !== row) { close(); suppressClick(); s = null; return; }
    if (!row || !root.contains(row)) { s = null; return; }
    const p = pt(e);
    s = { row, x0: p.clientX, y0: p.clientY, base: open?.row === row ? -ACTION_W : 0, mode: '', x: 0, act: null, hist: [] };
  }, { passive: true });

  root.addEventListener('touchmove', (e) => {
    if (!s) return;
    const p = pt(e);
    const dx = p.clientX - s.x0, dy = p.clientY - s.y0;
    if (!s.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.3 && (dx < 0 || s.base < 0)) {
        s.mode = 'swipe';
        s.act = open?.act || actFor(s.row);
        s.row.classList.add('swiping');
      } else if (Math.abs(dy) > 8 || Math.abs(dx) > 8) {
        s = null;   // vertikal: das ist Scrollen – nicht stören
        return;
      } else return;
    }
    e.preventDefault();
    const w = s.row.offsetWidth;
    let x = s.base + dx;
    if (x > 0) x = x / 4;                              // nach rechts nur zäh
    if (x < -w) x = -w - (-w - x) / 4;
    s.x = x;
    s.hist.push({ x, t: e.timeStamp });
    if (s.hist.length > 6) s.hist.shift();
    place(s.row, s.act, x);
  }, { passive: false });

  const end = () => {
    if (!s || s.mode !== 'swipe') { s = null; return; }
    const { row, act, x, hist } = s;
    s = null;
    suppressClick();
    row.classList.remove('swiping');
    const first = hist[0], last = hist[hist.length - 1];
    const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;   // px/ms
    const w = row.offsetWidth;
    if (x < -w * 0.6 || (v < -1.1 && x < -ACTION_W / 2)) { fire(row, act, x); return; }
    if (x < -ACTION_W / 2 || (v < -0.4 && x < -20)) {
      animateTo(row, act, x, -ACTION_W);
      open = { row, act };
      return;
    }
    animateTo(row, act, x, 0, () => { act.hidden = true; });
    if (open?.row === row) open = null;
  };
  root.addEventListener('touchend', end);
  root.addEventListener('touchcancel', end);

  // Tipp auf die Aktion bzw. irgendwo anders hin schließt.
  root.addEventListener('click', (e) => {
    if (open && !open.row.isConnected) { open.act.remove(); open = null; }
    const act = e.target.closest('.swipe-act');
    if (act && open && open.act === act) {
      e.stopPropagation();
      fire(open.row, act, -ACTION_W);
      return;
    }
    if (open) { e.stopPropagation(); e.preventDefault(); close(); }
  }, true);

  return { close: () => close(true) };
}

/* ---------------- Vom linken Rand zurückwischen ---------------- */

const FIELD = 'input,textarea,select,[contenteditable]:not([contenteditable="false"])';

/**
 * `strip` ist ein schmaler, fixierter Streifen am linken Rand (nur in Push-Ansichten
 * sichtbar, siehe CSS). Er hat touch-action: none – deshalb dürfen alle Listener passiv
 * sein. Was dort nicht zur Zurück-Geste wird, reicht er weiter: ein Tipp erreicht das
 * Element darunter, senkrechtes Ziehen scrollt die Ansicht darunter mit.
 * begin() → Controller aus motion.dragPop oder null (dann keine Geste);
 * commit() schaltet nach dem Zurückwischen die Ansicht um.
 */
export function edgeSwipe(strip, begin, commit) {
  let s = null;
  const under = (x, y) => {
    strip.style.pointerEvents = 'none';
    const el = document.elementFromPoint(x, y);
    strip.style.pointerEvents = '';
    return el;
  };

  strip.addEventListener('touchstart', (e) => {
    s = null;
    if (e.touches.length !== 1) return;
    const p = pt(e);
    const below = under(p.clientX, p.clientY);
    const scroller = below?.closest('.scroll') || null;
    s = { x0: p.clientX, y0: p.clientY, mode: '', ctl: null, hist: [], dx: 0, below, scroller, top: scroller?.scrollTop || 0 };
    // Beginnt die Berührung auf einem Eingabefeld: keine Zurück-Geste, nur weiterreichen.
    if (below?.closest(FIELD)) s.mode = 'field';
  }, { passive: true });

  strip.addEventListener('touchmove', (e) => {
    if (!s) return;
    const p = pt(e);
    const dx = p.clientX - s.x0, dy = p.clientY - s.y0;
    if (!s.mode || s.mode === 'field') {
      if (!s.mode && dx > 8 && dx > Math.abs(dy) * 1.2) {
        s.ctl = begin();
        if (!s.ctl) { s.mode = 'scroll'; return; }
        cancelPresses();
        s.mode = 'drag';
      } else if (Math.abs(dy) > 8 || Math.abs(dx) > 8) s.mode = 'scroll';
      else return;
    }
    if (s.mode === 'scroll') {
      // Der Streifen selbst scrollt nicht – die Ansicht darunter von Hand mitnehmen.
      if (s.scroller) s.scroller.scrollTop = s.top - dy;
      return;
    }
    s.dx = dx;
    s.hist.push({ x: dx, t: e.timeStamp });
    if (s.hist.length > 6) s.hist.shift();
    s.ctl.move(dx);
  }, { passive: true });

  const end = (e) => {
    if (!s) return;
    const cur = s;
    s = null;
    if (cur.mode !== 'drag') {
      // Nur getippt: an das Element unter dem Streifen weitergeben.
      if (e.type === 'touchend' && (!cur.mode || cur.mode === 'field') && cur.below?.isConnected) {
        if (e.cancelable) e.preventDefault();   // kein zweiter Klick auf den Streifen
        const field = cur.below.closest(FIELD);
        if (field) field.focus();
        else cur.below.click();
      }
      return;
    }
    const { ctl, dx, hist } = cur;
    // Keinen Klick aus der Geste entstehen lassen – aber auch nicht den nächsten echten
    // Tipp schlucken (etwa auf einen Tab, während die Ansicht noch zurückgleitet).
    if (e.cancelable) e.preventDefault();
    const first = hist[0], last = hist[hist.length - 1];
    const v = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const go = e.type === 'touchend' && (dx > ctl.width * 0.35 || v > 0.5);
    ctl.end(go, go ? commit : undefined);
  };
  strip.addEventListener('touchend', end);
  strip.addEventListener('touchcancel', end, { passive: true });
}
