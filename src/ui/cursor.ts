/**
 * The axe cursor.
 *
 * A CSS `cursor` image cannot animate, so the swing needs a real element that
 * follows the pointer. The CSS cursor stays set to the same axe as a fallback,
 * so before this runs — or if it never does — the pointer still looks right;
 * this only hides the native one once the follower is actually on screen.
 *
 * The pointer sits at the GRIP rather than the blade, so a click pivots the axe
 * around the hand the way a swing actually works. The blade sweeps; the hand
 * stays put.
 */

/** Follower size in CSS pixels. The art is authored at 176. */
const SIZE = 88;
/** Grip position within the art, at that size. */
const GRIP_X = 70;
const GRIP_Y = 74;

export function initAxeCursor(): () => void {
  // Touch has no pointer to follow, and coarse pointers get the native cursor.
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    return () => {};
  }

  const root = document.createElement('div');
  root.className = 'axe-cursor';
  root.setAttribute('aria-hidden', 'true');

  const img = document.createElement('img');
  img.src = '/cursor-axe-large.png';
  img.alt = '';
  img.width = SIZE;
  img.height = SIZE;
  img.style.marginLeft = `${-GRIP_X}px`;
  img.style.marginTop = `${-GRIP_Y}px`;
  root.appendChild(img);
  document.body.appendChild(root);

  document.documentElement.classList.add('axe-cursor-on');

  let x = -9999;
  let y = -9999;
  let frame = 0;

  const draw = () => {
    frame = 0;
    root.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  };

  const onMove = (event: PointerEvent) => {
    x = event.clientX;
    y = event.clientY;
    // Coalesce to one write per frame; pointermove can fire far more often.
    if (!frame) frame = requestAnimationFrame(draw);
    root.style.opacity = '1';
  };

  const onLeave = () => {
    root.style.opacity = '0';
  };

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const onDown = () => {
    if (reducedMotion.matches) {
      // Still give feedback, just not a sweeping one.
      img.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(0.88)' }, { transform: 'scale(1)' }],
        { duration: 140, easing: 'ease-out' },
      );
      return;
    }

    // Wind up against the swing, then chop through and settle.
    img.animate(
      [
        { transform: 'rotate(0deg)', offset: 0 },
        { transform: 'rotate(-30deg)', offset: 0.22 },
        { transform: 'rotate(46deg)', offset: 0.55 },
        { transform: 'rotate(-6deg)', offset: 0.8 },
        { transform: 'rotate(0deg)', offset: 1 },
      ],
      { duration: 420, easing: 'cubic-bezier(.34,1.3,.5,1)' },
    );
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  window.addEventListener('blur', onLeave);

  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    document.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('blur', onLeave);
    if (frame) cancelAnimationFrame(frame);
    document.documentElement.classList.remove('axe-cursor-on');
    root.remove();
  };
}
