// Übergänge zwischen den Ansichten – nur transform und opacity, damit nichts neu
// umbrochen werden muss. Bei „Bewegung reduzieren“ springt alles sofort.
//
// Arten: push (von rechts herein), pop (nach rechts hinaus), sheet-up (von unten),
// sheet-down (nach unten weg), fade (Tabwechsel), none.

const EASE = 'cubic-bezier(.32,.72,0,1)';   // wie die Federkurve von UIKit
const DUR = { push: 440, pop: 380, 'sheet-up': 460, 'sheet-down': 340, fade: 200 };
const PARALLAX = -0.28;                        // die Ansicht darunter wandert ein Stück mit

let active = null;   // { anims, cleanup }

export const reduced = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { void _; return false; }
};

/** Laufenden Übergang sofort abschließen (z. B. weil schon weiternavigiert wird). */
export function settle() {
  if (!active) return;
  const a = active;
  active = null;
  a.cleanup();
}

export const busy = () => !!active;

function reset(el) {
  el.style.zIndex = '';
  el.style.transform = '';
  el.style.pointerEvents = '';
  el.classList.remove('moving');
}

/**
 * Spielt einen Übergang von `from` nach `to` ab. `to` muss schon sichtbar sein;
 * `from` wird am Ende versteckt, sofern `keep(from)` nicht true liefert.
 */
export function run(kind, from, to, keep = () => false) {
  settle();
  const finish = () => {
    if (from && from !== to && !keep(from)) from.hidden = true;
  };
  if (!from || !to || from === to || kind === 'none' || reduced() || typeof to.animate !== 'function') {
    finish();
    return Promise.resolve();
  }
  const opt = { duration: DUR[kind] || 300, easing: EASE, fill: 'both' };
  const anims = [];
  const a = (el, frames, o = opt) => anims.push(el.animate(frames, o));
  from.style.pointerEvents = 'none';

  if (kind === 'push') {
    to.style.zIndex = '2';
    to.classList.add('moving');
    a(to, [{ transform: 'translateX(100%)' }, { transform: 'none' }]);
    a(from, [{ transform: 'none' }, { transform: `translateX(${PARALLAX * 100}%)` }]);
  } else if (kind === 'pop') {
    from.style.zIndex = '2';
    from.classList.add('moving');
    a(from, [{ transform: 'none' }, { transform: 'translateX(100%)' }]);
    a(to, [{ transform: `translateX(${PARALLAX * 100}%)` }, { transform: 'none' }]);
  } else if (kind === 'sheet-up') {
    to.style.zIndex = '2';
    to.classList.add('moving', 'sheet');
    a(to, [{ transform: 'translateY(100%)' }, { transform: 'none' }]);
    a(from, [{ transform: 'none', opacity: 1 }, { transform: 'scale(.94)', opacity: 0.55 }]);
  } else if (kind === 'sheet-down') {
    from.style.zIndex = '2';
    from.classList.add('moving', 'sheet');
    a(from, [{ transform: 'none' }, { transform: 'translateY(100%)' }], { ...opt, easing: 'cubic-bezier(.4,0,.8,.6)' });
    a(to, [{ transform: 'scale(.94)', opacity: 0.55 }, { transform: 'none', opacity: 1 }]);
  } else {
    to.style.zIndex = '2';
    a(to, [{ opacity: 0 }, { opacity: 1 }], { ...opt, easing: 'ease-out' });
  }

  return new Promise((resolve) => {
    const me = {
      cleanup: () => {
        finish();
        for (const x of anims) { try { x.cancel(); } catch (_) { void _; } }
        reset(from); reset(to);
        from.classList.remove('sheet'); to.classList.remove('sheet');
        resolve();
      },
    };
    active = me;
    Promise.all(anims.map(x => x.finished)).then(() => {
      if (active === me) { active = null; me.cleanup(); }
    }, () => { /* abgebrochen: settle() hat schon aufgeräumt */ });
  });
}

/**
 * Zurückwischen: die aktuelle Ansicht folgt dem Finger, die vorige liegt darunter.
 * Liefert { move(px), end(commit, onDone) → Promise }.
 */
export function dragPop(cur, prev) {
  settle();
  const w = cur.getBoundingClientRect().width || window.innerWidth;
  prev.hidden = false;
  cur.style.zIndex = '2';
  cur.classList.add('moving');
  prev.style.pointerEvents = 'none';
  cur.style.pointerEvents = 'none';
  let x = 0;
  const place = () => {
    cur.style.transform = `translateX(${x}px)`;
    prev.style.transform = `translateX(${PARALLAX * (w - x)}px)`;
  };
  place();
  return {
    width: w,
    move(px) { x = Math.max(0, Math.min(w, px)); place(); },
    // onDone läuft vor dem Zurücksetzen – dort den Zustand umschalten, sonst blitzt die Ansicht auf.
    end(commit, onDone = () => {}) {
      const target = commit ? w : 0;
      const left = Math.abs(target - x) / w;
      const done = () => {
        if (!commit) prev.hidden = true;
        onDone();
        reset(cur); reset(prev);
      };
      if (reduced() || typeof cur.animate !== 'function' || left < 0.01) { done(); return Promise.resolve(); }
      const o = { duration: Math.max(140, 360 * left), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' };
      const a1 = cur.animate([{ transform: `translateX(${x}px)` }, { transform: `translateX(${target}px)` }], o);
      const a2 = prev.animate([{ transform: `translateX(${PARALLAX * (w - x)}px)` }, { transform: `translateX(${PARALLAX * (w - target)}px)` }], o);
      return Promise.all([a1.finished, a2.finished]).catch(() => null).then(() => {
        done();
        a1.cancel(); a2.cancel();
      });
    },
  };
}
